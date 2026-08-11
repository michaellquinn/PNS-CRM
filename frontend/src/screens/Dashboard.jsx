import { useCallback, useEffect, useState } from "react";
import { api, SERVICES, STATUSES, rp } from "../api";
import { Chip, Head, Pill, Sla, Tile, usePnsTeam } from "../ui";

const EMPTY = { search: "", status: [], service: [], acct: [], owner: "", sales: "",
                stage: "", from: "", to: "" };

// The account tier decides routing, pricing ceilings, PSP entry and exec sign-off — it
// is the single most consequential field on a ticket, so it filters like status does.
const TIERS = ["Hypercare", "Strategic", "Non-Strategic"];

// The eleven statuses read as a wall when they sit in one flat row, and half of them
// share the word "Pending". Grouped by who is acting, the row answers the question
// people actually bring to the filter: "show me what's stuck at approval" or "show me
// what's out with the shipper". Any status missing from these lists (a future addition)
// falls into a trailing group so it can never silently disappear from the filter.
const STATUS_GROUPS = [
  ["Being worked", ["Pending Sales", "Pending PNS", "Pending Vendor"]],
  ["In approval", ["Pending Review - Head PNS", "Pending Review - Head Sales",
                   "Pending Review - PSP", "Pending Review - C-level"]],
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
      owner: f.owner, sales: f.sales, stage: f.stage, acct_type: f.acct,
      submitted_from: f.from, submitted_to: f.to,
    }).then((d) => setRows(d.tickets)).catch(() => setRows([]));
  }, [f]);

  const [counts, setCounts] = useState({});
  const [stageNames, setStageNames] = useState([]);
  const [minePending, setMinePending] = useState(null);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    // One unfiltered fetch feeds the salesperson and Sales CRM stage dropdowns and the
    // per-status counts on the filter chips. The counts stay fixed while filters are
    // applied: they describe the whole book, not the current selection.
    api.tickets({}).then((d) => {
      setSalesNames([...new Set(d.tickets.map((t) => t.sales).filter(Boolean))].sort());
      setStageNames([...new Set(d.tickets.map((t) => t.stage).filter(Boolean))].sort());
      const c = { __acct: {} };
      for (const t of d.tickets) {
        c[t.status] = (c[t.status] || 0) + 1;
        c.__acct[t.acct_type] = (c.__acct[t.acct_type] || 0) + 1;
      }
      setCounts(c);
    }).catch(() => {});
    // "Mine" is role-aware on the server: what I raised (Sales) or what I'm assigned
    // (PNS). The tile shows how much of it still needs a move.
    api.tickets({ mine: true }).then((d) => {
      setMinePending(d.tickets.filter((t) => t.status.startsWith("Pending")).length);
    }).catch(() => setMinePending(null));
  }, []);

  // Per-phase counts for the tiles, from the same grouping as the filter chips.
  const phaseCount = (label) => {
    const group = STATUS_GROUPS.find(([l]) => l === label)?.[1] || [];
    return group.reduce((n, s) => n + (counts[s] || 0), 0);
  };
  const phaseFilter = (label) => {
    const group = STATUS_GROUPS.find(([l]) => l === label)?.[1] || [];
    const on = group.every((s) => f.status.includes(s)) && f.status.length === group.length;
    setF((p) => ({ ...p, status: on ? [] : group }));
  };
  const phaseOn = (label) => {
    const group = STATUS_GROUPS.find(([l]) => l === label)?.[1] || [];
    return f.status.length === group.length && group.every((s) => f.status.includes(s));
  };

  const canSeeMargin = me.permissions.seeMargin;
  const cols = ["Ticket", "Submitted", "Shipper", "Service", "Revenue", "Status",
                "Priced by", "In status", canSeeMargin && "Margin", "PNS PIC",
                me.permissions.setSales && "Sales"].filter(Boolean);
  const active =
    f.search || f.status.length || f.service.length || f.acct.length || f.owner
    || f.sales || f.stage || f.from || f.to;

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
        <>
          {/* The book broken down by phase, not just won/lost. Each phase tile is a
              filter: click it and the table below narrows to those statuses. */}
          <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            <Tile label="Being worked" value={phaseCount("Being worked")}
                  sub="intake & pricing" onClick={() => phaseFilter("Being worked")}
                  on={phaseOn("Being worked")} />
            <Tile label="In approval" value={phaseCount("In approval")}
                  sub="review · head · PSP · exec" onClick={() => phaseFilter("In approval")}
                  on={phaseOn("In approval")} tone="text-amber-600" />
            <Tile label="With shipper" value={phaseCount("With shipper")}
                  sub="proposal submitted" onClick={() => phaseFilter("With shipper")}
                  on={phaseOn("With shipper")} tone="text-teal-600" />
            <Tile label="Won" value={stats.won} sub="accepted" tone="text-emerald-600" />
            <Tile label="Lost" value={stats.lost} sub="cumulative" tone="text-rose-600" />
            <Tile label="Win rate" value={stats.win_rate === null ? "—" : `${stats.win_rate}%`}
                  sub={`${stats.won} won of ${stats.won + stats.lost} decided`} tone="text-emerald-600" />
          </div>
          <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            {minePending !== null && (
              <Tile label="Waiting on me" value={minePending}
                    sub={me.group === "PNS" ? "my assigned, still pending" : "my tickets, still pending"}
                    tone={minePending > 0 ? "text-[#EE1B2C]" : "text-emerald-600"} />
            )}
            {/* total_year is a historical field name: the query has no date filter, so
                this is every ticket ever raised. Label it for what it counts. */}
            <Tile label="Total" value={stats.total_year} sub="all time" />
            <Tile label="Showing" value={rows.length} sub={active ? "after filters" : "no filters"} />
          </div>
        </>
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
          {/* Sales CRM's commercial stage — reference data carried on imported tickets.
              It is not this app's status and the sync never overwrites ours with it. */}
          {stageNames.length > 0 && (
            <select className={sel} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
              <option value="">Any Sales CRM stage</option>
              <option value="__none__">Not from Sales CRM</option>
              {stageNames.map((n) => <option key={n}>{n}</option>)}
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
        {/* Tier decides routing, ceilings, PSP entry and exec sign-off, so it filters
            alongside status rather than hiding in a dropdown. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <span className="w-14 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Tier</span>
          {TIERS.map((s) => (
            <Chip key={s} on={f.acct.includes(s)} onClick={() => toggle("acct", s)}>
              {s}{counts.__acct?.[s] ? ` · ${counts.__acct[s]}` : ""}
            </Chip>
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
                  {/* Shipper names run long — "PT. Mostrans Global Digilog - Project PT
                      Agroveta Husada Dharma - LTL (B2BR)" — and truncating them hid the
                      part that tells two tickets apart. The name wraps in full instead. */}
                  <td className="min-w-[260px] px-4 py-3.5 font-medium">
                    {t.shipper}
                    <span className={`ml-2 rounded px-1.5 text-[11px] font-semibold ${
                      t.acct_type === "Hypercare" ? "bg-fuchsia-50 text-fuchsia-700"
                      : t.acct_type === "Strategic" ? "bg-violet-50 text-violet-700"
                      : "text-slate-400 font-normal"}`}>{t.acct_type}</span>
                    <span className="ml-1.5 text-[11.5px] font-normal text-slate-400">{t.region}</span>
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
