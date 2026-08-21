import { useEffect, useState } from "react";
import { api, rp } from "../api";
import { Card, Empty, Head, Pill } from "../ui";

/* Dropped requests, with the date and the name against each (Michael, 2026-08-18).
   Commercial raises plenty that turns out not to be feasible — no rate to price against,
   no vendor on the lane, a solution Ninja does not run — and PNS cancels those from
   Awaiting price. This is the record of what was dropped and why.

   Open to everyone who works the pipeline on purpose: "why did this one stop" is a
   question Commercial asks PNS and PNS asks Commercial, and an answer only one side can
   see is not an answer. */
export default function Cancelled({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.cancelled().then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  }, []);

  const total = (rows || []).reduce((n, t) => n + (t.revenue || 0), 0);

  return (
    <>
      <Head title="Cancelled"
        sub="Requests dropped because they could not be built. Each one carries the date, who cancelled it and the reason they gave — the reason is required at the time, so there is no blank row here unless the ticket was cancelled before this screen existed."
        right={rows && rows.length > 0 && (
          <span className="text-[12px] text-slate-500">
            {rows.length} cancelled &middot; {rp(total)} of potential revenue
          </span>
        )} />

      {err && (
        <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>
      )}
      {rows === null && !err && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && <Empty>Nothing has been cancelled.</Empty>}

      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th className="whitespace-nowrap px-4 py-3.5">Ticket</th>
                  <th className="px-4 py-3.5">Shipper</th>
                  <th className="whitespace-nowrap px-4 py-3.5">Service</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-right">Revenue</th>
                  <th className="whitespace-nowrap px-4 py-3.5">Cancelled</th>
                  <th className="whitespace-nowrap px-4 py-3.5">By</th>
                  <th className="px-4 py-3.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.ref} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <button onClick={() => onOpen(t.ref)}
                        className="font-mono font-semibold text-[#EE1B2C] hover:underline">
                        {t.ref}
                      </button>
                    </td>
                    <td className="min-w-[220px] px-4 py-3.5 font-medium">
                      {t.shipper}
                      <span className="ml-2 text-[11.5px] font-normal text-slate-400">
                        {t.acct_type}{t.region ? ` · ${t.region}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">{t.service}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">
                      {rp(t.revenue)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono tabular-nums text-slate-600">
                      {t.at}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      {t.by === "not recorded"
                        ? <span className="text-slate-400">not recorded</span>
                        : t.by}
                    </td>
                    {/* The reason is the point of the screen, so it wraps in full rather
                        than being truncated to keep the row tidy. */}
                    <td className="min-w-[280px] px-4 py-3.5 text-slate-600">
                      {t.reason || <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <p className="mt-3 text-[12px] text-slate-400">
          A cancelled ticket is not deleted. Sales can put it back in the pipeline from
          the ticket itself if the deal becomes possible again, and its history —
          including this cancellation — travels with it.
        </p>
      )}
    </>
  );
}
