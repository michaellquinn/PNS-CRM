import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Empty, Head, Pill } from "../ui";

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

export default function Workload() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.workload().then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <Empty>{err}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;

  return (
    <>
      <Head title="Workload"
        sub={`Who is carrying what, and how quickly it clears. Past ${d.cap} tickets at Pending PNS, new work waits for the Head to assign it by hand.`} />

      <div className="mb-4">
        <Card>
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">PNS team</h2>
            <p className="text-[12px] text-slate-500">
              <b>Avg to clear</b> is the mean number of days from the first time a ticket
              entered <b>Pending PNS</b> to the first time it left PNS hands — reaching
              Proposal Submitted, or Pending Review - Head PNS. It counts only tickets
              that actually got there, so a ticket still sitting in the queue never
              flatters it and never inflates it. Mean rather than median because MySQL
              has no median; <b>Worst</b> sits beside it because on these volumes one
              stalled ticket moves the average and then hides inside it.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  {["PNS member", "Pending PNS", "Open total", "Avg to clear", "Worst",
                    "Finished", "Won / decided"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.pns.map((p) => (
                  <tr key={p.name} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">
                      {p.name}{" "}
                      {p.at_cap && <Pill tone="bg-rose-50 text-rose-700">at cap</Pill>}
                    </td>
                    <td className="px-4 py-3"><Bar n={p.pending_pns} cap={d.cap} /></td>
                    <td className="px-4 py-3 tabular-nums">{p.open_total}</td>
                    <td className="px-4 py-3 tabular-nums">{days(p.avg_days_to_clear)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500">{days(p.worst_days_to_clear)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500">{p.finished}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500">
                      {p.won} / {p.decided}
                    </td>
                  </tr>
                ))}
                {!d.pns.length && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">
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
