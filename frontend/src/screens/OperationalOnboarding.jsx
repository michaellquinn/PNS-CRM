import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

const TITLES = { onboarding: "Pending Information", readiness: "Ops Readiness", golive: "Go Live", handover: "Shipper List QC" };
const HELP = { onboarding: "Waiting on Sales to fill in and submit the onboarding requirements. Once submitted, a launch moves to Pending Readiness.",
  readiness: "Launches your team has points on, nearest go-live first. A launch your team owns nothing on is not listed here at all.",
  golive: "Every team is ready (or has an approved exception). Move each one to the Shipper List QC when it goes live.",
  handover: "Shippers that have gone live and are handed to QC. QC confirms each one here." };
// The go-live countdown on Pending Readiness (Michael, 2026-09-25): red once it is
// today or past, amber inside three days, plain after that.
const goLiveTone = (d) => d == null ? "bg-slate-100 text-slate-600"
  : d < 0 ? "bg-rose-100 text-rose-800"
  : d === 0 ? "bg-rose-100 text-rose-800"
  : d <= 3 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700";
const goLiveWords = (d) => d == null ? "no date"
  : d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue`
  : d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`;
const format = (v) => v ? String(v).replace("T", " ").slice(0, 16) + (String(v).length > 10 ? " WIB" : "") : "—";

export function OperationalList({ view = "onboarding", me, onOpen, notify = () => {} }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  // Where each launch stands for the team reading it (Michael, 2026-09-25).
  const [state, setState] = useState("");
  const [query, setQuery] = useState("");
  const [moving, setMoving] = useState("");
  const load = () => api.operationalList(view).then(setData).catch(e => setErr(e.message));
  useEffect(() => { setData(null); setErr(""); load(); }, [view]);
  // QC's own confirmation (Michael, 2026-09-23): nothing leaves the Shipper List QC
  // until QC says they have looked at it.
  const qcAccept = async (ref) => {
    if (!window.confirm(`Confirm QC accepts the operational handover for ${ref}?`)) return;
    setMoving(ref);
    try { await api.operationalQcAccept(ref); notify(`${ref} accepted by QC`); await load(); }
    catch (e) { notify(e.message); }
    finally { setMoving(""); }
  };
  // Go Live's one step onward (Michael, 2026-09-18).
  const handover = async (ref) => {
    if (!window.confirm(`Move ${ref} to the Shipper List QC? Today is recorded as its go-live and the launch requirements lock.`)) return;
    setMoving(ref);
    try { await api.operationalHandover(ref); notify(`${ref} moved to Shipper List QC`); await load(); }
    catch (e) { notify(e.message); }
    finally { setMoving(""); }
  };
  if (err) return <Empty>{err}</Empty>;
  const rows = (data?.rows || []).filter(r => (!filter || r.status === filter)
    && (!state || r.readiness_state === state)
    && `${r.ref} ${r.opportunity_name} ${r.shipper}`.toLowerCase().includes(query.toLowerCase()));
  const counted = (s) => (data?.rows || []).filter(r => r.readiness_state === s).length;
  return <>
    <Head title={TITLES[view]} sub={HELP[view]} right={data && <Pill>{rows.length} opportunities</Pill>} />
    <div className="mb-4 flex flex-wrap gap-2">
      <input className={`${inputCls} max-w-sm`} placeholder="Search opportunity or shipper" value={query} onChange={e => setQuery(e.target.value)} />
      {/* Status filter removed: Pending Information lists one status only. */}
      {view === "readiness" && <div className="flex flex-wrap gap-1">
        {[["", "All"], ["pending", "Pending"], ["ongoing", "Ongoing"], ["cleared", "Cleared"]].map(([v, label]) => (
          <button key={v} type="button" onClick={() => setState(v)} aria-pressed={state === v}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
              state === v ? "bg-[#EE1B2C] text-white" : "border border-slate-300 text-slate-600"}`}>
            {label}{v ? ` (${counted(v)})` : ` (${(data?.rows || []).length})`}
          </button>
        ))}
      </div>}
    </div>
    {!data ? <p>Loading…</p> : !rows.length ? <Empty>No opportunities waiting here.</Empty> : <div className="space-y-3">
      {rows.map(r => <Card key={r.ref} className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="font-mono font-semibold text-[#EE1B2C] hover:underline" onClick={() => onOpen(r.ref)}>{r.ref}</button>
          <Pill>{r.status}</Pill>{r.overdue && <Pill tone="bg-rose-100 text-rose-800">Confirmation overdue</Pill>}
          {view === "readiness" && r.points_total > 0 && (
            <Pill tone={r.readiness_state === "cleared" ? "bg-emerald-100 text-emerald-800"
              : r.readiness_state === "ongoing" ? "bg-sky-50 text-sky-700"
              : "bg-slate-100 text-slate-600"}>
              {r.points_done}/{r.points_total} confirmed
            </Pill>
          )}
          {view === "readiness" && (
            <Pill tone={goLiveTone(r.days_to_golive)}>
              Go live {r.planned_golive || "—"} · {goLiveWords(r.days_to_golive)}
            </Pill>
          )}
          <Btn className="ml-auto" onClick={() => onOpen(r.ref)}>Open onboarding</Btn>
          {view === "handover" && me.group === "QC" && r.status !== "QC accepted" && (
            <Btn kind="primary" disabled={moving === r.ref} onClick={() => qcAccept(r.ref)}>
              QC accepts handover
            </Btn>
          )}
          {view === "golive" && me.permissions.editOnboarding && (
            <Btn kind="primary" disabled={moving === r.ref} onClick={() => handover(r.ref)}>
              Move to Shipper List QC
            </Btn>
          )}
        </div>
        <h3 className="mt-2 text-[15px] font-semibold">{r.opportunity_name}</h3>
        <p className="mt-1 text-[12px] text-slate-500">CRM {r.opportunity_id || "—"} · {r.shipper} · {r.service} · Sales {r.sales || "unassigned"}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 text-[12px] text-slate-600">
          <span>First pickup: {format(r.pickup_at)}</span>
          {r.deadline && <span>Confirm by: {format(r.deadline)} (always before pickup)</span>}
          {r.actual_golive && <span>Actual go-live: {r.actual_golive}</span>}
        </div>
        {!!r.pending.length && <p className="mt-2 text-[12px] text-amber-800">Outstanding: {r.pending.join(" · ")}</p>}
      </Card>)}
    </div>}
    {/* "Existing monitoring records" stood here until 2026-09-14 (Michael). It listed
        rows from the ORIGINAL onboarding table that had not been migrated and were
        still live -- two of them, both stuck at "Awaiting QC acknowledgement" since
        August, which in that model means the target passed and nobody ever confirmed
        whether the shipper started shipping.

        Removing it does not resolve them. The old Onboarding screen is gone from the
        menu and the ticket's Onboarding tab reads the new process only, so nothing in
        the app lists them any more. GET /api/onboarding-v2/legacy is deliberately left
        in place: it is now the only way to see what is in there. */}
  </>;
}

// One point of a readiness card: confirmed on its own, or handed to another team with
// a note that says why it is theirs (Michael, 2026-09-25).
function CheckItem({ it, me, frozen, run, teams }) {
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const mine = !frozen && (me.group === it.owner_group || me.group === "Admin");
  const done = it.status === "confirmed";
  const act = (body) => run(() => api.operationalItem(it.id, { fingerprint: it.fingerprint, ...body }),
    body.action === "move" ? `Handed to ${body.to_group}` : "Point confirmed", true);
  // ONE LINE per task (Michael, 2026-09-25): the tick, the task, then its controls on
  // the same row. The stacked version turned seven tasks into a page of scrolling, and
  // a team reading its own card could not see the whole list at once.
  const field = "h-8 rounded-lg border border-slate-300 px-2 text-[12.5px]";
  return <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-1 py-1.5 last:border-b-0 ${done ? "bg-emerald-50/40" : ""}`}>
    <span className={`text-[12.5px] ${done ? "text-emerald-700" : "text-slate-300"}`}>{done ? "✓" : "○"}</span>
    <span className="min-w-[180px] flex-1 truncate text-[12.5px]" title={it.label}>{it.label}</span>
    {it.owner_group !== it.origin_group && (
      <span className="shrink-0 text-[11px] text-sky-700" title={it.moved_note || ""}>from {it.origin_group}</span>
    )}
    {done ? (
      <span className="shrink-0 text-[11px] text-slate-500">
        {it.confirmed_name}{it.note ? ` · ${it.note}` : ""}
      </span>
    ) : mine ? (
      <>
        <input className={`${field} w-[150px] shrink-0`} placeholder="Note"
          value={note} onChange={e => setNote(e.target.value)} />
        <button type="button" onClick={() => act({ action: "confirm", note })}
          className="h-8 shrink-0 rounded-lg bg-[#EE1B2C] px-3 text-[12.5px] font-medium text-white">
          Confirm
        </button>
        <select className={`${field} w-[110px] shrink-0`} value={to}
          onChange={e => setTo(e.target.value)}>
          <option value="">Hand to…</option>
          {teams.filter(g => g !== it.owner_group).map(g => <option key={g}>{g}</option>)}
        </select>
        <button type="button" disabled={!to || !note.trim()}
          title={to && !note.trim() ? "A note is required to hand a point over" : ""}
          onClick={() => act({ action: "move", to_group: to, note })}
          className="h-8 shrink-0 rounded-lg border border-slate-300 px-3 text-[12.5px] disabled:opacity-40">
          Hand over
        </button>
      </>
    ) : (
      <span className="shrink-0 text-[11px] text-slate-400">{it.owner_group} confirms</span>
    )}
  </div>;
}

function Check({ c, items, me, canEdit, frozen, run, teams }) {
  const [reason, setReason] = useState("");
  const [workaround, setWorkaround] = useState("");
  // Admin may act for any team (Michael, 2026-09-18); the server records it as such.
  const own = !frozen && (me.group === c.owner_group || me.group === "Admin");
  const mine = items.filter(i => i.check_key === c.check_key);
  const done = mine.filter(i => i.status === "confirmed").length;
  const act = (body) => run(() => api.operationalDecision(c.id, { fingerprint: c.fingerprint, ...body }), "Readiness decision recorded");
  return <div className="rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">{c.label}</b><Pill>{c.owner_group}</Pill>
      <Pill tone={c.approved_at ? "bg-orange-100 text-orange-800" : c.status === "ready" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
        {c.approved_at ? "Approved with exception" : c.status.replaceAll("_", " ")}
      </Pill>
    </div>
    {!!mine.length && <p className="mt-1 text-[11px] text-slate-500">
      {done}/{mine.length} confirmed{own ? "" : " · another team confirms these"}
    </p>}
    {c.note && <p className="mt-2 whitespace-pre-wrap text-[13px]">{c.note}</p>}
    {/* The card is ready when its points are; there is no whole-card button any more
        (Michael, 2026-09-25). Everyone sees every point, and confirms only their own. */}
    <div className="mt-2 rounded-lg border border-slate-200">
      {mine.map(it => <CheckItem key={`${it.id}-${it.fingerprint}`} it={it} me={me}
        frozen={frozen} run={run} teams={teams} />)}
      {!mine.length && <p className="p-2 text-[12px] text-slate-500">No points on this card.</p>}
    </div>
    {/* "Request an exception" removed from the card (Michael, 2026-09-25): readiness is
        settled point by point, and a point that cannot be met is handed to the team that
        can meet it. Any exception already recorded still shows below. */}
    {c.exception_reason && <div className="mt-3 rounded-lg bg-orange-50 p-3 text-[12px]">
      <b>Exception request</b><p className="whitespace-pre-wrap">{c.exception_reason}</p><p className="mt-1 whitespace-pre-wrap">Alternative: {c.workaround}</p>
      <p className="mt-1">Team feasibility: {c.feasible_by || "awaiting confirmation"}</p>
      <p>Sales Manager approval: {c.approved_by || "awaiting approval"}</p>
      {own && !c.feasible_at && <Btn className="mt-2" onClick={() => act({ action: "feasible" })}>Confirm workaround feasible</Btn>}
      {!frozen && me.permissions.approveOnboardingException && c.feasible_at && !c.approved_at && <Btn kind="primary" className="mt-2" onClick={() => act({ action: "approve" })}>Approve exception</Btn>}
      {!frozen && me.permissions.approveOnboardingException && <Btn className="ml-2 mt-2" onClick={() => { const reason = window.prompt("Reason for rejecting the exception?"); if (reason) act({ action: "reject", note: reason }); }}>Reject exception</Btn>}
    </div>}
  </div>;
}

export function OnboardingPane({ ticketRef, me, notify }) {
  const [data, setData] = useState(null);
  const [p, setP] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const load = (preserveInputs = false) => api.operationalDetail(ticketRef).then(d => { setData(d); if (!preserveInputs) setP(d.payload); setErr(""); }).catch(e => setErr(e.message));
  useEffect(() => { setData(null); setReviewed(false); load(); }, [ticketRef]);
  const run = async (fn, message, preserveInputs = false) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); notify(message); await load(preserveInputs); } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  if (err) return <Empty>{err}</Empty>;
  if (!data) return <p>Loading onboarding…</p>;
  const editable = data.can_edit && data.eligible && !data.actual_golive;
  // A No switch sets its quantity to 0; switching back to Yes clears it for a real
  // number (Michael, 2026-09-17). The server does the same, so the page cannot disagree.
  const COUNT_OF = { pickup_tkbm: "pickup_tkbm_count", delivery_tkbm: "delivery_tkbm_count", implan: "implan_count" };
  const SWITCH_OF = Object.fromEntries(Object.entries(COUNT_OF).map(([s, c]) => [c, s]));
  const set = (key, value) => setP(prev => {
    const next = { ...prev, [key]: value };
    if (COUNT_OF[key]) next[COUNT_OF[key]] = value === "No" ? "0" : prev[COUNT_OF[key]] === "0" ? "" : prev[COUNT_OF[key]];
    return next;
  });
  const HOURS = Array.from({ length: 25 }, (_, h) => String(h).padStart(2, "0"));
  const save = (submit) => run(() => api.operationalSave(ticketRef, { payload: p, revision: data.revision, submit, documents_reviewed: reviewed }), submit ? "Submitted · operational database updated · team confirmations requested" : "Draft saved");
  const upload = (kind, file) => {
    if (!file) return;
    const form = new FormData(); form.append("file", file); form.append("kind", kind);
    run(() => api.operationalUpload(ticketRef, form), "Operational document uploaded", true);
  };
  return <div className={busy ? "pointer-events-none opacity-70" : ""}>
    <div className="mb-4 rounded-xl bg-sky-50 p-4">
      <div className="flex flex-wrap gap-2"><Pill>{data.status}</Pill><Pill>Revision {data.revision}</Pill>{data.submitted_at && <Pill>Database synced on submission</Pill>}</div>
      <p className="mt-2 text-[12px] text-slate-600">Sales submits by D-1 20:00 WIB. Teams confirm the same day or next day 20:00 maximum, always before pickup. Onboarding does not change pricing, status, ownership or ticket approval routing.</p>
      {data.submitted_at && <p className="mt-1 text-[12px]">Requirements submitted: {format(data.submitted_at)}</p>}
      {!data.eligible && <p className="mt-2 font-medium text-amber-800">Input is available when the opportunity is Ready to Ship.</p>}
    </div>
    <h3 className="mb-3 font-semibold">Sales requirements</h3>
    <p className="mb-4 text-[12px] text-slate-500">Inputs marked * are needed to submit; the treatment details, handling request and driver requirements are optional. Manpower No requires quantity 0. Greyed answers come from the Project Charter and are not retyped here — correct them on the ticket’s Project Charter tab and they follow. Product type, shipment mode, MPS, RDO and shipment frequency always follow the charter: if one is blank, fill it there first.</p>
    {[...new Set(data.fields.map(f => f.section))].map(section => <section key={section} className="mb-5">
      <h4 className="mb-3 border-b pb-2 text-[13px] font-semibold text-slate-700">{section}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {data.fields.filter(f => f.section === section).map(f => { const Field = f.type === "packing" ? "div" : "label";
          /* Answers the Project Charter already holds are shown, not asked for again
             (Michael, 2026-09-14). Two boxes for one answer gets two answers, and then
             nobody can say which one Ops built the launch against. Correct it on the
             ticket's Project Charter tab and this follows.

             The server decides which keys these are and only locks one the charter can
             actually fill -- the form refuses to submit while any input is blank, so a
             locked empty field would be a dead end with no way forward. */
          const fixed = (data.locked || []).includes(f.key);
          const autoZero = SWITCH_OF[f.key] && p[SWITCH_OF[f.key]] === "No";
          const off = !editable || fixed || autoZero;
          // Split on the dash even when only one side is picked yet, or choosing "From" first
          // would blank both boxes. A pre-range "10:00" has no dash and shows empty.
          const [hFrom = "", hTo = ""] = String(p[f.key] || "").includes("-") ? String(p[f.key]).split("-") : [];
          return <Field key={f.key} className={f.type === "textarea" || f.type === "packing" ? "md:col-span-2" : ""}>
          <span className="mb-1 block text-[12px] text-slate-600">
            {f.label} {fixed
              ? <span className={`font-normal ${f.follows_charter && !p[f.key] ? "text-amber-700" : "text-slate-400"}`}>
                  · {f.follows_charter && !p[f.key] ? "blank — fill it on the Project Charter" : "from the Project Charter"}</span>
              : f.required ? "*" : <span className="font-normal text-slate-400">· optional</span>}
          </span>
          {f.type === "packing" ? <div className="flex flex-wrap gap-3 rounded-lg border p-3">{f.options.map(tag => <label key={tag} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" disabled={off} checked={(p.packing || []).includes(tag)} onChange={e => {
              const tags = p.packing || [];
              set("packing", e.target.checked ? tag === "No" ? ["No"] : [...tags.filter(t => t !== "No"), tag] : tags.filter(t => t !== tag));
            }} />{tag} · {data.packing_labels[tag]}
          </label>)}</div> : f.type === "select" ? <select className={inputCls} disabled={off} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)}>
            <option value="">Choose…</option>{f.options.map(v => <option key={v}>{v}</option>)}
          </select> : f.type === "hour_range" ? <div className="flex items-center gap-2">
            <select className={inputCls} disabled={off} value={hFrom} onChange={e => set(f.key, `${e.target.value}-${hTo || ""}`)}>
              <option value="">From</option>{HOURS.slice(0, 24).map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <span className="text-slate-400">to</span>
            <select className={inputCls} disabled={off} value={hTo} onChange={e => set(f.key, `${hFrom || ""}-${e.target.value}`)}>
              <option value="">To</option>{HOURS.slice(1).map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div> : f.type === "textarea" ? <textarea className={`${inputCls} min-h-[76px]`} disabled={off} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)} /> :
          <input className={inputCls} type={f.type} step={f.type === "number" ? "any" : undefined} disabled={off || ["opportunity_id", "service"].includes(f.key)} value={p[f.key] ?? ""} onChange={e => set(f.key, e.target.value)} />}
        </Field>; })}
      </div>
    </section>)}
    <section className="mb-5 rounded-xl border p-4">
      <h4 className="mb-2 font-semibold text-[13px]">Operational uploads</h4>
      <p className="mb-3 text-[12px] text-slate-500">Optional. The product photo Sales attached to the ticket is used here; upload one only if there is none. Only operational material — no pricing/revenue or commercial documents (5 MB per file).</p>
      {/* Photos attached to the ticket itself (Michael, 2026-09-17), so Sales does not
          upload the same picture twice. "All pickup points" is gone. */}
      {!!(data.charter_photos || []).length && <div className="mb-3">
        <b className="text-[12px]">Product photo from the ticket</b>
        {data.charter_photos.map(ph => <a key={ph.id} className="ml-3 text-[12px] text-sky-700 underline" href={`/api/onboarding-v2/tickets/${ticketRef}/charter-photos/${ph.id}`} target="_blank" rel="noreferrer">{ph.filename}</a>)}
      </div>}
      {[['product_photo', (data.charter_photos || []).length ? 'Another product photo' : 'Product photo']].map(([kind,label]) => <div key={kind} className="mb-3">
        <b className="text-[12px]">{label}</b>
        {data.documents.filter(d => d.kind === kind).map(d => <a key={d.id} className="ml-3 text-[12px] text-sky-700 underline" href={`/api/onboarding-v2/documents/${d.id}`} target="_blank" rel="noreferrer">{d.filename}</a>)}
        {editable && !data.submitted_at && <input className="mt-1 block text-[12px]" type="file" accept={kind === "product_photo" ? "image/*" : undefined} onChange={e => upload(kind,e.target.files[0])} />}
      </div>)}
    </section>
    {editable && <div className="mb-6 space-y-3">
      <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I verified all requirements for this opportunity and confirm operational uploads contain no pricing, revenue or commercial-only information.</label>
      <div className="flex gap-2"><Btn onClick={() => save(false)}>Save draft</Btn><Btn kind="primary" disabled={!reviewed} onClick={() => save(true)}>{data.submitted_at ? "Submit revised requirements" : "Submit onboarding"}</Btn></div>
      {data.submitted_at && <p className="text-[12px] text-amber-800">Draft edits remain private until resubmitted. Changed requirements will require affected teams to reconfirm.</p>}
    </div>}
    {!!data.checks.length && <section className="mb-6">
      <h3 className="mb-3 font-semibold">Team readiness and exceptions</h3>
      <div className="space-y-3">{data.checks.map(c => <Check key={`${c.id}-${c.fingerprint}`} c={c}
        items={data.items || []} me={me} frozen={!!data.actual_golive}
        canEdit={data.can_edit && !data.actual_golive} run={run} teams={data.teams || []} />)}</div>
      <p className="mt-3 text-[12px] text-slate-500">Each card is confirmed point by point, and only by the team that holds the point. A point that is not yours can be handed to the right team with a note; it then leaves your count and joins theirs. Only the assigned team can confirm. Sales Managers approve exceptions after the team's feasible workaround confirmation. Assign team accounts under Users & roles.</p>
    </section>}
    {/* "Actual go-live and QC handover" removed (Michael, 2026-09-18). */}
    <details className="text-[12px]"><summary className="cursor-pointer font-semibold">Operational history</summary>{data.events.map((e,n) => <div key={n} className="border-b py-2"><span className="text-slate-500">{format(e.at)} · {e.actor}</span><p className="whitespace-pre-wrap break-words">{e.body}</p></div>)}</details>
  </div>;
}

export function OperationalTicket({ ticketRef, me, notify, onBack }) {
  return <><Head title={`Opportunity ${ticketRef}`} sub="Operational view · commercial tabs, attachments and discussion are restricted" right={<Btn onClick={onBack}>Back</Btn>} />
    <Card><div className="border-b px-4 py-3 font-semibold text-[#EE1B2C]">Onboarding</div><div className="p-4"><OnboardingPane ticketRef={ticketRef} me={me} notify={notify} /></div></Card></>;
}

export function OperationalDatabase({ me, notify, onOpen }) {
  const [data,setData] = useState(null); const [err,setErr] = useState("");
  const [file,setFile] = useState(null); const [preview,setPreview] = useState(null); const [busy,setBusy] = useState(false);
  const load = () => api.operationalMaster().then(setData).catch(e=>setErr(e.message));
  useEffect(()=>{load();},[]);
  const send = async commit => {
    setBusy(true);
    try { const form=new FormData();form.append("file",file);form.append("commit",String(commit));form.append("digest",preview?.digest || "");
      const r=await api.operationalImport(form);if(commit){notify(`Imported ${r.imported} records`);setPreview(null);await load();}else setPreview(r);
    }catch(e){notify(e.message);}finally{setBusy(false);}
  };
  return <><Head title="Operational Database" sub="Reusable opportunity-level records. Automatically updated after Sales submits. No pricing or revenue."
      right={<a href="/api/operational-master/export.xlsx"><Btn>Export to Excel</Btn></a>} />
    {me.permissions.importOperational && <Card className="mb-4 space-y-3 p-4">
      <a className="text-[13px] text-sky-700 underline" href="/api/operational-master/template.xlsx">Download Excel template</a>
      <input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files[0]);setPreview(null);}} className="block text-[13px]" />
      <p className="text-[12px] text-slate-500">Global ID must be text. Opportunity Name + Service must match exactly one eligible CRM opportunity. Preview before import; blank cells, duplicates and conflicts are rejected.</p>
      <Btn disabled={!file || busy} onClick={()=>send(false)}>Preview Excel import</Btn>
      {preview && <div className="text-[12px]"><p>{preview.preview.length} valid rows · {preview.errors.length} errors</p>{preview.errors.map(e=><p className="text-rose-700" key={e}>{e}</p>)}
        {preview.preview.map(r=><p key={r.ref}>{r.action} · {r.ref} · {r.values.join(" · ")}</p>)}
        <Btn kind="primary" disabled={busy || !!preview.errors.length || !preview.preview.length} onClick={()=>send(true)}>Confirm import</Btn>
      </div>}
    </Card>}
    {err && <Empty>{err}</Empty>}
    {data && <Card className="overflow-x-auto"><table className="w-full text-left text-[13px]"><thead><tr>{data.columns.map(c=><th key={c} className="border-b p-3">{c}</th>)}</tr></thead>
      <tbody>{data.rows.map(r=><tr key={r.ticket_id}><td className="p-3 font-mono">{r.global_id}</td><td className="p-3"><button className="text-sky-700 hover:underline" onClick={()=>onOpen(r.ticket_ref)}>{r.opportunity_name}</button></td><td className="p-3">{r.service}</td><td className="p-3">{r.pickup_function}</td><td className="p-3">{r.delivery_function}</td></tr>)}</tbody></table>{!data.rows.length && <Empty>No operational records yet. Sales submission creates them automatically.</Empty>}</Card>}
  </>;
}
