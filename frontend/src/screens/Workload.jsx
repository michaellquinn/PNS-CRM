import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head, Pill } from "../ui";

// Queue depth and lead time belong on one screen. A long queue on someone who clears
// fast is a different problem from a short one that has stopped moving, and you cannot
// tell them apart from either number alone.

function Bar({ n, cap }) {
  const pct = Math.min(100, Math.round((n / Math.max(cap, 1)) * 100));
  const tone = n >= cap ? "bg-rose-400" : n >= cap * 0.7 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-[12.5px]">{n}</span>
    </div>
  );
}

const days = (v) => (v === null || v === undefined ? "—" : `${v}d`);

/* Who new PNS work goes to (Michael, 2026-10-07). It was written into the code, so a
   change of people — someone resigning, someone joining — needed a deploy. It is edited
   here now by the Head of PNS or Admin, and a Save decides the very next ticket.

   Only tickets assigned AFTER the Save are affected. A ticket that already has a PNS PIC
   keeps it: moving existing work is a hand-over on the ticket, on purpose. */
function People({ members, picked, editing, onChange, empty }) {
  const name = (e) => members.find((m) => m.email === e)?.name || e;
  if (!editing) {
    return picked.length
      ? <span>{picked.map(name).join(", ")}</span>
      : <span className="text-slate-400">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const on = picked.includes(m.email);
        return (
          <button key={m.email} type="button" aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((x) => x !== m.email) : [...picked, m.email])}
            className={`rounded-full px-2.5 py-1 text-[12px] ${on
              ? "bg-[#EE1B2C] font-semibold text-white" : "border border-slate-300 text-slate-600"}`}>
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

function AssignRules({ notify }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.assignRules().then((x) => { setD(x); setDraft(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <Card className="mb-4 p-4 text-[13px] text-rose-700">{err}</Card>;
  if (!d) return null;
  const r = draft || d.rules;
  const editing = !!draft;
  const set = (patch) => setDraft({ ...r, ...patch });
  const save = async () => {
    setBusy(true);
    try { await api.setAssignRules(draft); notify?.("Assignment rules saved — they apply to new tickets from now"); await load(); }
    catch (e) { notify?.(e.message); }
    finally { setBusy(false); }
  };
  const row = (label, hint, picked, onChange, empty) => (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="w-56 px-4 py-2.5">
        <div className="font-semibold">{label}</div>
        {hint && <div className="text-[11.5px] text-slate-400">{hint}</div>}
      </td>
      <td className="px-4 py-2.5">
        <People members={d.members} picked={picked} editing={editing} onChange={onChange} empty={empty} />
      </td>
    </tr>
  );
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold">Auto-assignment rules</h2>
          <p className="text-[12px] text-slate-500">
            Who a new PNS ticket goes to: the lightest-loaded person named for its service, under the cap.
            A change applies to tickets assigned from the moment you save — tickets that already have a PNS PIC keep it.
            {d.updated_by && <> Last changed by {d.updated_by}{d.updated_at ? ` on ${d.updated_at}` : ""}.</>}
          </p>
        </div>
        {d.editable && (editing ? (
          <span className="flex gap-2">
            <Btn onClick={() => setDraft(null)}>Cancel</Btn>
            <Btn kind="primary" disabled={busy || !r.default.length} onClick={save}>Save rules</Btn>
          </span>
        ) : <Btn onClick={() => setDraft(JSON.parse(JSON.stringify(d.rules)))}>Edit rules</Btn>)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <tbody>
            {row("Default pool", "Every service without its own people below",
              r.default, (v) => set({ default: v }), "Nobody — every ticket is left for the Head")}
            {d.services.map((svc) => row(svc, null, r.services[svc] || [],
              (v) => set({ services: { ...r.services, [svc]: v } }), "Default pool"))}
            {row("Complex Logistics — new account", "An account not shipping yet",
              r.complex_new, (v) => set({ complex_new: v }), "Nobody — left for the Head")}
            {row("Complex Logistics — live account", "An account already shipping",
              r.complex_live, (v) => set({ complex_live: v }), "Nobody — left for the Head")}
            <tr>
              <td className="px-4 py-2.5">
                <div className="font-semibold">Cap</div>
                <div className="text-[11.5px] text-slate-400">Pending PNS tickets per person</div>
              </td>
              <td className="px-4 py-2.5">
                {editing
                  ? <input type="number" min={1} max={100} value={r.cap}
                      onChange={(e) => set({ cap: Number(e.target.value) })}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1.5" />
                  : <span>{r.cap} — past this, new work is left unassigned for the Head</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {editing && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-[11.5px] text-slate-500">
          A service left empty uses the default pool. If everyone named for a service is away or at the cap, the ticket is left
          unassigned for the Head — except that a service's specialists falling away hands it to the default pool.
          Someone who has resigned should also be set inactive under Users &amp; roles; their open tickets stay with them until handed over.
        </p>
      )}
    </Card>
  );
}

export default function Workload({ notify }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.workload().then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <Empty>{err}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;

  return (
    <>
      <Head title="Workload"
        sub={d.full
          ? `Who is carrying what, and how quickly it clears. Pending PNS is each person's share of the Pricing - PNS queue, plus Sales prices they are reviewing and tickets waiting in Pending Requirement (Unassigned included). Past ${d.cap} the auto-assigner stops, and new work is left unassigned for you to place by hand.`
          : `Who is carrying what, so you can tell whether to pick something up. Pending PNS is each person's share of the Pricing - PNS queue, plus Sales prices they are reviewing and tickets waiting in Pending Requirement (Unassigned included). Past ${d.cap} the auto-assigner stops and new work is left unassigned.`} />

      <AssignRules notify={notify} />

      <div className="mb-4">
        <Card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">PNS team</h2>
            <p className="text-[12px] text-slate-500">
              {!d.full ? (
                <>
                  Queue depth only. Days-to-clear and won/decided are a per-person
                  comparison and stay with the Head of PNS &mdash; this is here so
                  &ldquo;should I take this one?&rdquo; is answerable, not to rank anyone.
                </>
              ) : (<>
              <b>Avg to clear</b> is the average number of <b>working days</b> (Mon–Fri)
              PNS actually held a ticket — only the time spent in Pending PNS or Pending
              Review - PNS, from the first time it got there to the first time it left
              PNS hands. Time waiting on Sales, a requirement or a vendor is not counted.
              Only finished tickets count; <b>Worst</b> sits beside it because on these
              volumes one stalled ticket moves the average. <b>Won / decided</b> is won
              out of won + lost — cancelled and parked deals are left out.
              </>)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  {["PNS member", "Pending PNS", "Open total",
                    ...(d.full ? ["Avg to clear", "Worst", "Finished", "Won / decided"] : []),
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.pns.map((p) => (
                  <tr key={p.name} className={`border-t border-slate-100 ${p.unassigned ? "bg-amber-50/50 italic text-slate-600" : ""}`}>
                    <td className="px-4 py-3 font-medium">
                      {p.name}{" "}
                      {p.at_cap && <Pill tone="bg-rose-50 text-rose-700">at cap</Pill>}
                    </td>
                    <td className="px-4 py-3"><Bar n={p.pending_pns} cap={d.cap} /></td>
                    <td className="px-4 py-3 tabular-nums">{p.open_total}</td>
                    {/* Absent from the payload entirely for a non-Head, not merely
                        hidden here — the figures never leave the server. */}
                    {d.full && p.unassigned && <td colSpan={4} className="px-4 py-3 text-[12px] text-slate-400">nobody holds these yet</td>}
                    {d.full && !p.unassigned && (
                      <>
                        <td className="px-4 py-3 tabular-nums">{days(p.avg_days_to_clear)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-500">{days(p.worst_days_to_clear)}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-500">{p.finished}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-500">{p.won} / {p.decided}</td>
                      </>
                    )}
                  </tr>
                ))}
                {!d.pns.length && (
                  <tr><td colSpan={d.full ? 7 : 3} className="px-4 py-6 text-center text-slate-500">
                    No active PNS members registered.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Salespeople with the most open tickets</h2>
          <p className="text-[12px] text-slate-500">
            The demand side of the same picture: a spike here usually explains a queue
            on the PNS side. &ldquo;Waiting on them&rdquo; is what Sales owes back.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {["Salesperson", "Open tickets", "Waiting on them", "Avg age"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.sales.map((s) => (
                <tr key={s.email || s.name} className="border-t border-slate-100">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 tabular-nums">{s.open_tickets}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {s.waiting_on_them > 0
                      ? <Pill tone="bg-sky-50 text-sky-700">{s.waiting_on_them}</Pill>
                      : <span className="text-slate-400">0</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{days(s.avg_age_days)}</td>
                </tr>
              ))}
              {!d.sales.length && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Nothing open.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
