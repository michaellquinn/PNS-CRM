import { useCallback, useEffect, useState } from "react";
import { api, SERVICES, STATUSES, rp } from "../api";
import { Chip, Head, Pill, Sla, Tile, usePnsTeam } from "../ui";

const EMPTY = { search: "", status: [], service: [], owner: "", sales: "", from: "", to: "" };

// The eleven statuses read as a wall when they sit in one flat row, and half of them
// share the word "Pending". Grouped by who is acting, the row answers the question
// people actually bring to the filter: "show me what's stuck at approval" or "show me
// what's out with the shipper". Any status missing from these lists (a future addition)
// falls into a trailing group so it can never silently disappear from the filter.
const STATUS_GROUPS = [
  ["Being worked", ["Pending Sales", "Pending PNS", "Pending Vendor"]],
  ["In approval", ["Pending PNS Review", "Pending Head Review",
                   "Pending PSP Approval", "Pending Exec Sign-off"]],
  ["With shipper", ["Proposal Submitted"]],
  ["Decided", ["Proposal Accepted / Ready to Ship", "Lost", "Cancel"]],
];

// "1 / 7d" means nothing without the rule behind it, and the header has no room for it.
const COL_HINTS = {
  "In status": "Days the ticket has spent in its current status, against the target for that status",
};

export default function Dashboard({ me, onOpen }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [salesNames, setSalesNames] = useState([]);
  const team = usePnsTeam();

  const toggle = (key, v) =>
    setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));

  const load = useCallback(() => {
    api.tickets({
      search: f.search, status: f.status, service: f.service,
      owner: f.owner, sales: f.sales,
      submitted_from: f.from, submitted_to: f.to,
    }).then((d) => setRows(d.tickets)).catch(() => setRows([]));
  }, [f]);

  const [counts, setCounts] = useState({});

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    // One unfiltered fetch feeds both the salesperson dropdown and the per-status
    // counts on the filter chips. The counts stay fixed while filters are applied:
    // they describe the whole book, not the current selection.
    api.tickets({}).then((d) => {
      setSalesNames([...new Set(d.tickets.map((t) => t.sales).filter(Boolean))].sort());
      const c = {};
      for (const t of d.tickets) c[t.status] = (c[t.status] || 0) + 1;
      setCounts(c);
    }).catch(() => {});
  }, []);

  const canSeeMargin = me.permissions.seeMargin;
  const cols = ["Ticket", "Submitted", "Shipper", "Service", "Revenue", "Status",
                "Priced by", "In status", canSeeMargin && "Margin", "PNS PIC",
                me.permissions.setSales && "Sales"].filter(Boolean);
  const active =
    f.search || f.status.length || f.service.length || f.owner || f.sales || f.from || f.to;

  const sel = "rounded-lg border border-slate-300 px-3 py-2 text-[13.5px]";

  // Export exactly what is on screen, and only the columns this role may see — margin
  // stays out of the file for anyone without seeMargin, same rule as the table.
  const exportCsv = () => {
    const head = ["Ticket", "Submitted", "Shipper", "Account type", "Region", "Service",
                  "Revenue", "Status", "Priced by", "PNS review", "SLA days", "SLA target",
                  ...(canSeeMargin ? ["Margin %"] : []), "PNS PIC", "Sales"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")].concat(rows.map((t) => [
      t.ref, t.submitted_on, t.shipper, t.acct_type, t.region, t.service, t.revenue,
      t.status, t.priced_by, t.needs_review ? "yes" : "no", t.sla_elapsed, t.sla_target,
      ...(canSeeMargin ? [t.margin ?? ""] : []), t.owner || "", t.sales || "",
    ].map(esc).join(",")));
    const url = URL.createObjectURL(
      new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ninja-pns-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head title="Dashboard"
        sub="Every ticket you're allowed to see. Filters stack, so combine as many as you need."
        right={
          <button onClick={exportCsv} disabled={!rows.length}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium disabled:opacity-40">
            Export CSV ({rows.length})
          </button>
        } />

      {stats && (
        <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
          <Tile label="Ongoing" value={stats.ongoing} sub="pending + proposals" />
          <Tile label="Win rate" value={stats.win_rate === null ? "—" : `${stats.win_rate}%`}
                sub={`${stats.won} won of ${stats.won + stats.lost} decided`} tone="text-emerald-600" />
          <Tile label="Lost" value={stats.lost} sub="cumulative" tone="text-rose-600" />
          <Tile label="Won" value={stats.won} sub="accepted" tone="text-emerald-600" />
          {/* total_year is a historical field name: the query has no date filter, so
              this is every ticket ever raised. Label it for what it counts. */}
          <Tile label="Total" value={stats.total_year} sub="all time" />
          <Tile label="Showing" value={rows.length} sub={active ? "after filters" : "no filters"} />
        </div>
      )}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="search" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })}
            placeholder="Search shipper or ID…"
            className="min-w-[230px] max-w-[320px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-[13.5px]" />
          <span className="text-xs text-slate-500">Submitted</span>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={sel} />
          <span className="text-slate-400">→</span>
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={sel} />
          <select className={sel} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
            <option value="">Any PNS PIC</option>
            <option value="__unassigned__">Unassigned</option>
            {team.map((n) => <option key={n}>{n}</option>)}
          </select>
          {me.permissions.setSales && (
            <select className={sel} value={f.sales} onChange={(e) => setF({ ...f, sales: e.target.value })}>
              <option value="">Any salesperson</option>
              {salesNames.map((n) => <option key={n}>{n}</option>)}
            </select>
          )}
          <button onClick={() => setF(EMPTY)}
            className="ml-auto rounded-lg bg-rose-50 px-4 py-2 text-[13.5px] font-semibold text-[#EE1B2C] hover:bg-[#EE1B2C] hover:text-white">
            Clear all
          </button>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <span className="w-14 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Status</span>
          {[...STATUS_GROUPS,
            ["Other", STATUSES.filter((s) => !STATUS_GROUPS.some(([, g]) => g.includes(s)))]]
            .filter(([, g]) => g.length)
            .map(([label, group]) => (
            <span key={label} className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-300">{label}</span>
              {group.map((s) => (
                <Chip key={s} on={f.status.includes(s)} onClick={() => toggle("status", s)}>
                  {s}{counts[s] ? ` · ${counts[s]}` : ""}
                </Chip>
              ))}
            </span>
          ))}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <span className="w-14 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Service</span>
          {SERVICES.map((s) => (
            <Chip key={s} on={f.service.includes(s)} onClick={() => toggle("service", s)}>{s}</Chip>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {cols.map((h) => (
                  <th key={h} title={COL_HINTS[h]}
                    className={`whitespace-nowrap px-4 py-3.5 ${h === "Revenue" ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.ref} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <button onClick={() => onOpen(t.ref)}
                      className="font-mono font-semibold text-[#EE1B2C] hover:underline">{t.ref}</button>
                    {t.open_questions > 0 && (
                      <span title={`${t.open_questions} unanswered question(s)`}
                        className="ml-1.5 rounded-full bg-amber-100 px-1.5 font-mono text-[10.5px] font-bold text-amber-800">
                        {t.open_questions}?
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono tabular-nums text-slate-600">{t.submitted_on}</td>
                  <td className="max-w-[230px] truncate px-4 py-3.5 font-medium">
                    {t.shipper}
                    <span className="ml-2 text-[11.5px] font-normal text-slate-400">{t.acct_type} · {t.region}</span>
                    {/* Reference only: the Sales CRM stage is not this app's status, so it stays quieter than everything around it. */}
                    {t.stage && (
                      <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10.5px] font-normal text-slate-400">
                        SF: {t.stage}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">{t.service}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">{rp(t.revenue)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5"><Pill dot>{t.status}</Pill></td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    {t.priced_by}
                    {t.needs_review && <span className="ml-1.5 text-[11.5px] text-violet-600">· PNS review</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <Sla elapsed={t.sla_elapsed} target={t.sla_target} />
                  </td>
                  {canSeeMargin && (
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono tabular-nums">
                      {t.margin == null ? "—" : `${t.margin}%`}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                    {t.owner || <span className="text-slate-400">unassigned</span>}
                  </td>
                  {me.permissions.setSales && (
                    <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                      {t.sales || <span className="text-slate-400">—</span>}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-slate-400">
                  No tickets match those filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
