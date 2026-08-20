import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Head, Pill, StagePill } from "../ui";

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

      {/* Sales CRM's stage is not our status — but some stages DO move ours, and which
          ones was only discoverable by reading the backend. Served from the same
          constants the sync applies, so it cannot drift from what actually happens. */}
      <Card className="mb-4">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">
            What a Sales CRM stage does to our status
          </h2>
          <p className="text-[12px] text-slate-500">
            The two are different questions: Sales CRM owns the <b>commercial stage</b>,
            this app owns the <b>solutioning status</b>. Three stages override ours — the
            two terminal ones, plus <b>Proposal Submitted</b>, which is not terminal but
            does say the price already reached the shipper. Everything else leaves ours
            alone, which is why a deal can sit at Negotiation there while PNS is still
            pricing here.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {d.stage_rules.map((r, i) => (
            <div key={i} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {r.stages.map((st) => <StagePill key={st}>{st}</StagePill>)}
                </div>
                <div className="mt-1.5 text-[12px]">
                  <span className="text-slate-400">becomes </span>
                  {r.becomes
                    ? <Pill dot>{r.becomes}</Pill>
                    : <b className="text-slate-600">nothing — our status is untouched</b>}
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-slate-600">{r.why}</p>
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
