import { useEffect, useState } from "react";
import { api, LOSS_REASONS, rp } from "../api";
import { Btn, Card, Empty, Head } from "../ui";

/* What stopped, when, who said so and why — for BOTH decided-negative outcomes.
   Cancelled since 2026-08-18; Lost added 2026-09-11 because a ticket moved to Lost
   appeared on no screen at all and simply vanished from the app (Michael).

   One component and one endpoint, parameterised, rather than a copy. They ask the same
   question of the same audience and differ in exactly two places: the words, and the
   coded loss reason a cancellation has no equivalent of. A second copy would have been
   the place the two drifted — see the Proposals queue that was deleted on 2026-09-08
   for having become an unreachable duplicate of a screen that had moved on.

   Open to everyone who works the pipeline on purpose: "why did this one stop" is a
   question Commercial asks PNS and PNS asks Commercial, and an answer only one side can
   see is not an answer. */
const COPY = {
  cancelled: {
    title: "Cancelled",
    sub: "Requests dropped because they could not be built. Each one carries the date, who cancelled it and the reason they gave — the reason is required at the time, so there is no blank row here unless the ticket was cancelled before this screen existed.",
    noun: "cancelled",
    empty: "Nothing has been cancelled.",
    when: "Cancelled",
    foot: "A cancelled ticket is not deleted.",
  },
  lost: {
    title: "Lost",
    sub: "Deals the shipper did not take. Each one carries the date, who recorded it and the coded reason — that code is what the win rate is built from, so a wrong one is worth correcting here.",
    noun: "lost",
    empty: "Nothing has been lost.",
    when: "Lost",
    foot: "A lost deal is not deleted.",
  },
};

// The coded reason as a person reads it. Falls back to the raw code rather than blank:
// "salescrm" is set by the sync and is not in the pickable list, and an unknown code is
// still more use than an empty cell.
const lossLabel = (code) =>
  (LOSS_REASONS.find(([v]) => v === code) || [null, code])[1];

function Decided({ me, onOpen, notify, kind }) {
  const c = COPY[kind];
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () =>
    (kind === "lost" ? api.lost() : api.cancelled())
      .then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [kind]);

  // Back onto the unclaimed shelf, not into a queue naming a side. A deal that could not
  // be built and now can is somebody's to pick up again, and which side prices it is
  // re-derived on the way in rather than assumed — see reopen() in the backend.
  const putBack = async (t) => {
    setBusy(t.ref);
    try {
      await api.reopen(t.ref, "Open");
      notify(`${t.ref} is back in Open`);
      await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  const total = (rows || []).reduce((n, t) => n + (t.revenue || 0), 0);

  return (
    <>
      <Head title={c.title} sub={c.sub}
        right={rows && rows.length > 0 && (
          <span className="text-[12px] text-slate-500">
            {rows.length} {c.noun} &middot; {rp(total)} of potential revenue
          </span>
        )} />

      {err && (
        <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>
      )}
      {rows === null && !err && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && <Empty>{c.empty}</Empty>}

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
                  <th className="whitespace-nowrap px-4 py-3.5">{c.when}</th>
                  <th className="whitespace-nowrap px-4 py-3.5">By</th>
                  <th className="px-4 py-3.5">Reason</th>
                  <th className="px-4 py-3.5"></th>
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
                      {/* The coded reason first where there is one: it is the fact the
                          win rate is computed from, and the free text beneath it is
                          whoever recorded it saying more. */}
                      {t.loss_reason && (
                        <div className="mb-0.5 font-medium text-slate-700">
                          {lossLabel(t.loss_reason)}
                        </div>
                      )}
                      {t.reason
                        || (t.loss_reason ? null : <span className="text-slate-300">—</span>)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      {me.permissions.reopen && (
                        <Btn disabled={busy === t.ref} onClick={() => putBack(t)}>
                          Return to Open
                        </Btn>
                      )}
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
          {c.foot} <b>Return to Open</b> puts it back on the
          unclaimed shelf for somebody to pick up, with its history — including this
          cancellation and the reason — travelling with it. Which side prices it is
          worked out again on the way back in, so a deal PNS was pricing does not
          reappear as Sales&rsquo;.
        </p>
      )}
    </>
  );
}

/* Two menu entries, one screen. Default export stays Cancelled so nothing that already
   imports it has to change. */
export default function Cancelled(p) { return <Decided {...p} kind="cancelled" />; }
export function Lost(p) { return <Decided {...p} kind="lost" />; }
