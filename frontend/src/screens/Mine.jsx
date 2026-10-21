import { useEffect, useState } from "react";
import { api, rp } from "../api";
import { Card, Empty, Head, Pill, TicketCard } from "../ui";

// "Mine" is deliberately role-aware: a salesperson sees what they raised, a PNS member
// sees what they were assigned. Both want the same first answer — what is waiting on me
// right now — so the split at the top is by who owes the next move, not by status.

// Pending Requirement is here for the same reason Pending Sales is: it is a ticket
// waiting on this salesperson to act. Leaving it out would notify them that data is
// missing and then not show the deal on the one screen they open to see their own work.
const OWED_BY_SALES = ["Pending Sales", "Pending Requirement"];

// Which slice of my tickets to show (Michael, 2026-10-21): what is still moving, and what
// has finished and how. A Stage picker narrows any of them to one status.
const VIEWS = [
  ["open", "Open"], ["won", "Won"], ["lost", "Lost"], ["cancelled", "Cancelled"], ["all", "All"],
];
const PNS_OWED = ["Pending PNS", "Pending Review - Head PNS", "Pending Vendor", "Pending Review - PNS"];
const isOpen = (t) => !t.status.startsWith("Proposal Accepted") && t.status !== "Lost" && t.status !== "Cancel";
const inView = (v, t) => v === "all" ? true
  : v === "open" ? isOpen(t)
  : v === "won" ? t.status.startsWith("Proposal Accepted")
  : v === "lost" ? t.status === "Lost"
  : t.status === "Cancel";

export default function Mine({ me, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("open");
  const [stage, setStage] = useState("");

  useEffect(() => {
    api.tickets({ mine: true })
      .then((d) => setRows(d.tickets))
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty>{err}</Empty>;
  if (!rows) return <Empty>Loading…</Empty>;

  const isPns = me.group === "PNS";
  // "Waiting on you" is decided per ticket by what you are ON it: its PNS owner owes the
  // PNS steps, its Sales PIC owes the Sales ones. One person can be both on different
  // tickets -- the Head of PNS raising a deal by hand, say.
  const owesMe = (t) => (t.owner === me.name && PNS_OWED.includes(t.status))
    || (t.sales === me.name && OWED_BY_SALES.includes(t.status));
  const shown = rows.filter((t) => inView(view, t));
  const stages = [...new Set(shown.map((t) => t.status))].sort();
  const list = shown.filter((t) => !stage || t.status === stage);
  const onMe = list.filter((t) => isOpen(t) && owesMe(t));
  const elsewhere = list.filter((t) => !onMe.includes(t));
  const count = (v) => rows.filter((t) => inView(v, t)).length;

  const Group = ({ title, sub, list }) => (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <span className="text-[12px] text-slate-500">{sub}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">
          {list.length}
        </span>
      </div>
      {list.length === 0 ? (
        <Card><p className="px-4 py-5 text-[13px] text-slate-500">Nothing here.</p></Card>
      ) : (
        list.map((t) => (
          <TicketCard key={t.ref} t={t} onOpen={onOpen}>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
              <Pill>{t.service}</Pill>
              <span>{rp(t.revenue)}</span>
              {t.owner && t.owner !== me.name && <span className="text-slate-400">PNS: {t.owner}</span>}
              {t.sales && t.sales !== me.name && <span className="text-slate-400">Sales: {t.sales}</span>}
              <span className="ml-auto text-slate-400">
                {t.sla_elapsed}/{t.sla_target}d in this status
              </span>
            </div>
          </TicketCard>
        ))
      )}
    </div>
  );

  return (
    <>
      <Head title="My requests"
        sub={isPns
          ? "Tickets assigned to you, or that you raised."
          : "Tickets you raised, that you are the Sales PIC on, or that you own in PNS."} />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        {VIEWS.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v}
            onClick={() => { setView(v); setStage(""); }}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${view === v
              ? "bg-[#EE1B2C] text-white" : "border border-slate-300 text-slate-600"}`}>
            {label} ({count(v)})
          </button>
        ))}
        <select className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-[12.5px]"
          value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Every stage</option>
          {stages.map((st) => <option key={st}>{st}</option>)}
        </select>
      </Card>
      {view === "open" ? <>
        <Group title="Waiting on you" list={onMe}
          sub="you owe the next move" />
        <Group title="In progress elsewhere" list={elsewhere}
          sub="someone else owes the next move" />
      </> : (
        <Group title={VIEWS.find(([v]) => v === view)[1]} list={list}
          sub={view === "all" ? "every ticket of yours, newest first" : ""} />
      )}
    </>
  );
}
