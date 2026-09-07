import { useEffect, useState } from "react";
import { api } from "../api";
import {
  Btn, Card, Empty, Head, Pill, TicketCard, inputCls, useScrollMemory,
} from "../ui";

// Onboarding is not solutioning, so it lives outside that menu. Solutioning ends when the
// shipper accepts; onboarding begins there and asks a different question — can Ops
// actually take this on, and is QC ready to inherit it.
//
// Two screens either side of one act. "To hand over" is the deals nobody has triggered
// yet; "Onboarding" is everything in flight. The act between them creates a record, emails
// the Kick-off to PNS, Sales, Ops and QC, and tells all four that a shipper is coming.

const PHASE_TONE = {
  preparing: "bg-sky-50 text-sky-700",
  // Amber, not red: the target passed and nobody said whether the shipper started. That
  // is a question for QC, not a failure.
  overdue: "bg-amber-100 text-amber-900",
  // The one week PNS and QC are both on the hook. Coloured apart from everything else
  // because it is the only phase where accountability is shared.
  gray: "bg-violet-50 text-violet-700",
  live: "bg-emerald-50 text-emerald-700",
  did_not_start: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-600",
};

/* ==================================================================== to hand over */
// Accepted deals that have not been handed over yet. Sales' list: they hold the shipper
// relationship, so they are the ones who can produce the shipper ID and the date.
//
// Most rows arrive with both already filled in — Sales CRM carries the account's global_id
// and target_start_date, and the sync reads them. So this is "the deals Sales CRM did not
// tell us about", not a retyping queue.
export function ToHandOver({ me, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  const [live, setLive] = useState([]);
  const [err, setErr] = useState(null);
  const [inputs, setInputs] = useState({});
  const [busy, setBusy] = useState(null);
  useScrollMemory("handover", rows !== null);

  const load = () =>
    Promise.all([api.tickets({ status: "Proposal Accepted / Ready to Ship" }),
                 api.onboarding(false)])
      .then(([t, o]) => {
        const started = new Set(o.onboardings.map((x) => x.ref));
        setRows(t.tickets.filter((x) => !started.has(x.ref)));
        setLive(o.onboardings);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const start = async (t, force = false) => {
    const v = inputs[t.ref] || {};
    const shipperId = (v.shipperId ?? t.input?.shipperId ?? "").trim();
    const golive = (v.golive ?? t.input?.golive ?? "").trim();
    if (!shipperId || !golive)
      return notify("Both the shipper ID and the target go-live date are needed");
    setBusy(t.ref);
    try {
      const r = await api.startOnboarding(t.ref, {
        shipper_id: shipperId, target_golive: golive, force,
      });
      notify(`${t.ref} — ${r.status}`);
      await load();
    } catch (e) {
      // The shipper is already onboarded somewhere. PNS may say it is a second real deal;
      // anybody else is being told to go and check, because it is usually a typo.
      if (/already onboarded/i.test(e.message) && me.permissions.raiseRequirement) {
        if (window.confirm(`${e.message}\n\nStart a second onboarding for this shipper?`))
          return start(t, true);
      } else notify(e.message);
    } finally { setBusy(null); }
  };

  const set = (ref, k) => (e) =>
    setInputs({ ...inputs, [ref]: { ...(inputs[ref] || {}), [k]: e.target.value } });

  if (err) return <Empty>{err}</Empty>;

  return (
    <>
      <Head title="To hand over"
        sub="Accepted deals nobody has handed to Ops and QC yet. Starting one creates the onboarding record, emails the Kick-off to PNS, Sales, Ops and QC, and asks Ops and QC to confirm they are ready."
        right={rows && <Pill tone="bg-amber-50 text-amber-700">{rows.length} waiting</Pill>} />
      {rows === null && <p className="text-sm text-slate-400">Loading…</p>}
      {rows?.length === 0 && (
        <Empty>
          Nothing waiting. Every accepted deal has been handed over —
          {" "}<b>{live.length}</b> {live.length === 1 ? "is" : "are"} in flight on the
          Onboarding screen.
        </Empty>
      )}
      <div className="flex flex-col gap-3">
        {(rows || []).map((t) => {
          const v = inputs[t.ref] || {};
          const fromCrm = !!(t.input?.shipperId && t.input?.golive);
          return (
            <TicketCard key={t.ref} t={t} onOpen={onOpen}>
              {fromCrm && (
                <p className="mb-2 text-[12px] text-emerald-800">
                  Shipper ID and target date came from Sales CRM. Check them and hand it over.
                </p>
              )}
              {me.permissions.startOnboarding ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input className={inputCls} placeholder="Shipper ID *"
                    value={v.shipperId ?? t.input?.shipperId ?? ""}
                    onChange={set(t.ref, "shipperId")} />
                  <input className={inputCls} type="date"
                    value={v.golive ?? t.input?.golive ?? ""}
                    onChange={set(t.ref, "golive")} />
                  <Btn kind="primary" disabled={busy === t.ref}
                    onClick={() => start(t)}>
                    {busy === t.ref ? "Starting…" : "Start onboarding"}
                  </Btn>
                  <p className="text-[11.5px] text-slate-400 sm:col-span-3">
                    One shipper ID per ticket. A corporate going live as several shippers
                    is one deal per shipper.
                  </p>
                </div>
              ) : (
                <p className="text-[12.5px] text-slate-500">
                  Sales hand this over — they hold the shipper relationship.
                </p>
              )}
            </TicketCard>
          );
        })}
      </div>
    </>
  );
}

/* ======================================================================== the board */

// Reservation / MPS / Tracking, pasted rather than typed one at a time. Sales copy these
// out of a sheet, so the box takes a whole column at once and the server splits it.
function IdBox({ ob, kinds, notify, onDone, canEdit }) {
  const [kind, setKind] = useState("reservation");
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!values.trim()) return notify("Paste at least one id");
    setBusy(true);
    try {
      const r = await api.addOnboardingIds(ob.id, { kind, values });
      notify(r.status); setValues(""); await onDone();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const drop = async (rid, value) => {
    if (!window.confirm(`Remove ${value}?`)) return;
    try { await api.removeOnboardingId(ob.id, rid); notify(`${value} removed`); await onDone(); }
    catch (e) { notify(e.message); }
  };

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {Object.entries(kinds).map(([k, label]) => {
        const mine = ob.ids.filter((i) => i.kind === k);
        if (!mine.length) return null;
        return (
          <div key={k} className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="w-[104px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </span>
            {mine.map((i) => (
              <span key={i.id}
                className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11.5px] text-slate-700"
                title={`added by ${i.added_by_name || "?"} on ${String(i.added_at).slice(0, 10)}`}>
                {i.value}
                {canEdit && (
                  <button onClick={() => drop(i.id, i.value)}
                    className="ml-1.5 text-slate-400 hover:text-rose-600">×</button>
                )}
              </span>
            ))}
          </div>
        );
      })}
      {!ob.ids.length && (
        <p className="mb-2 text-[12px] text-amber-800">
          No reservation or tracking ids yet — QC cannot monitor this shipper until there
          are some.
        </p>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <select className={`${inputCls} max-w-[150px]`} value={kind}
            onChange={(e) => setKind(e.target.value)}>
            {Object.entries(kinds).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <textarea className={`${inputCls} min-h-[38px] flex-1`} value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder="Paste ids — commas, spaces or new lines all work" />
          <Btn disabled={busy} onClick={add}>{busy ? "Adding…" : "Add"}</Btn>
        </div>
      )}
    </div>
  );
}

// What PNS asked of Ops and QC, and whether the team it was asked of has said yes.
function Requirements({ ob, me, notify, onDone }) {
  if (!ob.requirements.length) return null;
  const ack = async (r) => {
    try { await api.ackRequirement(r.id); notify(`${r.area_label} acknowledged`); await onDone(); }
    catch (e) { notify(e.message); }
  };
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        Special requirements from PNS
      </div>
      {ob.requirements.map((r) => (
        <div key={r.id} className="mb-2 rounded-lg bg-slate-50 px-3 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Pill tone="bg-violet-50 text-violet-700">{r.area_label}</Pill>
            <span className="text-[11.5px] text-slate-500">for {r.owner}</span>
            {r.acked_at ? (
              <span className="text-[11.5px] font-medium text-emerald-700">
                ✓ {r.acked_by_name} acknowledged
              </span>
            ) : (
              <span className="text-[11.5px] font-medium text-amber-800">
                not acknowledged
              </span>
            )}
            {!r.acked_at && me.permissions.ackRequirement && me.group === r.owner && (
              <Btn className="ml-auto" onClick={() => ack(r)}>Acknowledge</Btn>
            )}
          </div>
          <p className="whitespace-pre-wrap text-[12.5px] text-slate-700">{r.body}</p>
        </div>
      ))}
    </div>
  );
}

function OnboardingCard({ ob, me, kinds, notify, reload, onOpen }) {
  const p = me.permissions;
  const [date_, setDate] = useState("");

  const act = async (fn, msg) => {
    try { const r = await fn(); notify(r?.status || msg); await reload(); }
    catch (e) { notify(e.message); }
  };

  // Either door to the same fact. Sales report it; QC are asked once the target has
  // passed with nobody reporting anything.
  const canConfirm = p.confirmGolive && !ob.actual_golive;
  const canAck = p.ackGolive && ob.phase === "overdue";
  const mineToTick = (me.group === "Ops" && !ob.ops_ready_by)
                  || (me.group === "QC" && !ob.qc_ready_by);

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={() => onOpen(ob.ref)}
          className="font-mono text-[13px] font-semibold text-[#EE1B2C] hover:underline">
          {ob.ref}
        </button>
        <span className="text-[14px] font-semibold">{ob.shipper}</span>
        <Pill tone={PHASE_TONE[ob.phase]}>{ob.phase_label}</Pill>
        <span className="ml-auto font-mono text-[12px] text-slate-500">
          shipper {ob.shipper_id}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-slate-600">
        <span>Target <b className="font-mono">{ob.target_golive}</b></span>
        {ob.actual_golive
          ? <span>Live since <b className="font-mono">{ob.actual_golive}</b>
              {ob.golive_source === "qc_ack" && " (QC acknowledged)"}</span>
          : ob.days_to_golive != null && (
              <span className={ob.days_to_golive < 0 ? "font-medium text-amber-800" : ""}>
                {ob.days_to_golive < 0
                  ? `${-ob.days_to_golive} days past target`
                  : `${ob.days_to_golive} days to go`}
              </span>
            )}
        {ob.service && <span>{ob.service}</span>}
        {ob.owner && <span>PNS {ob.owner}</span>}
        {ob.sales && <span>Sales {ob.sales}</span>}
      </div>

      {/* Readiness. Flagged loudly once the target is near or past, and blocking nothing —
          the shipper ships whether or not a tick exists. */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {[["Ops", ob.ops_ready_by], ["QC", ob.qc_ready_by]].map(([team, who]) => (
          <span key={team}
            className={`rounded-full px-2 py-0.5 font-medium ${who
              ? "bg-emerald-50 text-emerald-700"
              : ob.days_to_golive != null && ob.days_to_golive <= 0
                ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}>
            {team} {who ? `ready — ${who}` : "not ready"}
          </span>
        ))}
        {mineToTick && p.markReady && (
          <Btn onClick={() => act(() => api.markReady(ob.id), "Recorded")}>
            {me.group} is ready
          </Btn>
        )}
      </div>

      {(canConfirm || canAck) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-[12px] text-slate-600">
            {canAck
              ? "The target passed and nobody confirmed. Did this shipper start?"
              : "Has the shipper started shipping?"}
          </span>
          <input type="date" className={`${inputCls} max-w-[160px]`} value={date_}
            onChange={(e) => setDate(e.target.value)} />
          <Btn kind="primary"
            onClick={() => act(() => (canAck ? api.ackGolive : api.confirmGolive)(
              ob.id, { on: date_ || null }), "Recorded")}>
            {canAck ? "Acknowledge go-live" : "Confirm first shipment"}
          </Btn>
          <span className="text-[11px] text-slate-400">
            Blank means today. The gray week runs from this date.
          </span>
        </div>
      )}

      <Requirements ob={ob} me={me} notify={notify} onDone={reload} />
      <IdBox ob={ob} kinds={kinds} notify={notify} onDone={reload}
        canEdit={p.editOnboardingIds} />
    </Card>
  );
}

// Everything in flight, grouped by phase and soonest first. Ops and QC work from this.
export function Onboarding({ me, notify, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  useScrollMemory("onboarding", data !== null);

  const load = () => api.onboarding(!showAll).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [showAll]);

  if (err) return <Empty>{err}</Empty>;

  const rows = data?.onboardings || [];
  const groups = [
    ["overdue", "Awaiting QC acknowledgement"],
    ["gray", "Gray week — PNS and QC both accountable"],
    ["preparing", "Preparing"],
    ["live", "QC owned"],
    ["did_not_start", "Did not start"],
    ["cancelled", "Cancelled"],
  ].map(([k, label]) => [k, label, rows.filter((r) => r.phase === k)])
   .filter(([, , list]) => list.length);

  return (
    <>
      <Head title="Onboarding"
        sub="Shippers being brought live. PNS and QC are both accountable for the first week of shipping; after that it is QC's, in QC's own system."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {/* A real link, not a scripted download: the browser fetches it with the
                session cookie and names the file from the response header. */}
            <a href="/api/onboarding/export.csv"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px] font-medium hover:border-slate-400">
              Export ids (CSV)
            </a>
            <Btn onClick={() => setShowAll(!showAll)}>
              {showAll ? "Active only" : "Include closed"}
            </Btn>
            {data && <Pill tone="bg-emerald-50 text-emerald-700">{rows.length}</Pill>}
          </div>
        } />
      {data === null && <p className="text-sm text-slate-400">Loading…</p>}
      {data && !rows.length && (
        <Empty>
          Nothing in flight. Accepted deals waiting to be handed over are on
          {" "}<b>To hand over</b>.
        </Empty>
      )}
      {groups.map(([k, label, list]) => (
        <div key={k} className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              {label}
            </span>
            <Pill tone={PHASE_TONE[k]}>{list.length}</Pill>
          </div>
          <div className="flex flex-col gap-3">
            {list.map((ob) => (
              <OnboardingCard key={ob.id} ob={ob} me={me} kinds={data.kinds}
                notify={notify} reload={load} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
