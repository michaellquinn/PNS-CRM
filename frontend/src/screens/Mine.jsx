import { useEffect, useState } from "react";
import { api, rp } from "../api";
import { Card, Empty, Head, Pill, TicketCard } from "../ui";

// "Mine" is deliberately role-aware: a salesperson sees what they raised, a PNS member
// sees what they were assigned. Both want the same first answer — what is waiting on me
// right now — so the split at the top is by who owes the next move, not by status.

const OWED_BY_SALES = ["Pending Sales"];

export default function Mine({ me, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.tickets({ mine: true })
      .then((d) => setRows(d.tickets))
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty>{err}</Empty>;
  if (!rows) return <Empty>Loading…</Empty>;

  const isPns = me.group === "PNS";
  const open = rows.filter((t) => !t.status.startsWith("Proposal Accepted")
    && t.status !== "Lost" && t.status !== "Cancel");
  const onMe = open.filter((t) => isPns
    ? ["Pending PNS", "Pending Review - Head PNS", "Pending Vendor"].includes(t.status)
    : OWED_BY_SALES.includes(t.status));
  const elsewhere = open.filter((t) => !onMe.includes(t));
  const closed = rows.filter((t) => !open.includes(t));

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
              {!isPns && t.owner && <span className="text-slate-400">PNS: {t.owner}</span>}
              {isPns && t.sales && <span className="text-slate-400">Sales: {t.sales}</span>}
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
          ? "Tickets assigned to you. The first group is what you owe a move on."
          : "Tickets you raised. The first group is what Ninja is waiting on you for."} />
      <Group title="Waiting on you" list={onMe}
        sub={isPns ? "yours to price or progress" : "PNS cannot proceed until these come back"} />
      <Group title="In progress elsewhere" list={elsewhere}
        sub="someone else owes the next move" />
      {closed.length > 0 && <Group title="Closed" list={closed} sub="won, lost or cancelled" />}
    </>
  );
}
