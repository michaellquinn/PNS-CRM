import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Head, Pill } from "../ui";

// "Is there a clear trigger for how each status moves?" — Baskoro, 2026-08-14. There
// was one for every move, but it was spread across nine endpoints and could only be
// reconstructed by reading all of them, which is the same as not having one.
//
// The table is served from the backend's TRANSITIONS list, which is also what
// change_status() validates against. So this screen cannot drift from the rule: if a
// move is not on this page, the server refuses it.

function Group({ status, moves, manual }) {
  const out = moves.filter((m) => m.frm === status);
  const chosen = manual[status] || [];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <Pill dot>{status}</Pill>
        {chosen.length > 0 ? (
          <span className="text-[12px] text-slate-500">
            can be moved by hand to <b>{chosen.join(", ")}</b>
          </span>
        ) : (
          <span className="text-[12px] text-slate-500">
            nothing can be chosen from here — it moves by what happens next
          </span>
        )}
      </div>
      {out.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-slate-400">
          Nothing leads out of this status. It is where a ticket finishes.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {out.map((m, i) => (
            <div key={i} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <span className="text-[11px] text-slate-400">goes to </span>
                <b className="text-[13px]">{m.to}</b>
                <div className="mt-0.5 text-[11.5px] text-slate-500">{m.who}</div>
              </div>
              <div>
                <div className="text-[12.5px] leading-snug">{m.trigger}</div>
                <code className="mt-0.5 block font-mono text-[11px] text-slate-400">{m.via}</code>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function StatusFlow() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.statusFlow().then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <Card className="border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>;
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;

  const starts = d.moves.filter((m) => m.frm === "New ticket");

  return (
    <>
      <Head title="Status flow"
        sub="Every way a ticket changes status, and what causes it. This is generated from the rule the server enforces, not written alongside it — a move that is not on this page is refused." />

      <Card className="mb-4 p-4">
        <h2 className="text-[13.5px] font-semibold">Two kinds of move</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
          Most statuses are a <b>consequence</b>, not a choice: attaching a price, the
          Head of PNS finalising, a signature, the Sales CRM sync. The server works out
          where the ticket goes, which is why there is no dropdown for it — a person
          naming the next status is how an approval gets skipped.
          <br />
          A few moves <b>are</b> a choice — picking a ticket up, sending it back, marking
          it Lost — and those are the ones listed as “can be moved by hand” below.
        </p>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="text-[13.5px] font-semibold">Where a ticket starts</h2>
        <div className="mt-2 flex flex-col gap-1.5">
          {starts.map((m, i) => (
            <div key={i} className="text-[12.5px]">
              <b>{m.to}</b>
              <span className="text-slate-600"> — {m.trigger}</span>
              <span className="text-slate-400"> ({m.who})</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        {d.statuses.map((s) => (
          <Group key={s} status={s} moves={d.moves} manual={d.manual} />
        ))}
      </div>
    </>
  );
}
