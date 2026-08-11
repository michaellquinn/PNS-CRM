import { useCallback, useEffect, useMemo, useState } from "react";
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

// The tiles, one per status rather than one per phase. "In approval: 4" told you a
// number but not who was sitting on it; four separate tiles name the gate. Short labels
// because the status name is already long and the tile is narrow.
// Each tile is one status, labelled with the status itself. An abbreviation ("Sales",
// "Vendor") saved a few pixels and cost the reader the one thing the tile is for —
// knowing which status the number counts. The sub-line says who owes the move.
const TILES = [
  ["Pending Sales", "Sales owes the price"],
  ["Pending PNS", "PNS owes the price"],
  ["Pending Vendor", "waiting on vendor cost"],
  ["Pending Review - Head PNS", "PNS checks a Sales price"],
  ["Pending Review - Head Sales", "price below the floor"],
  ["Pending Review - PSP", "margin sign-off"],
  ["Pending Review - C-level", "Alex + Dhinesh"],
  ["Proposal Submitted", "out with the shipper"],
  ["Proposal Accepted / Ready to Ship", "won — to Legal, then Ops"],
  ["Lost", "with a stated reason"],
];

const TILE_TONE = {
  "Pending Review - Head PNS": "text-violet-600",
  "Pending Review - Head Sales": "text-amber-600",
  "Pending Review - PSP": "text-amber-600",
  "Pending Review - C-level": "text-fuchsia-600",
  "Proposal Submitted": "text-teal-600",
  "Proposal Accepted / Ready to Ship": "text-emerald-600",
  Lost: "text-rose-600",
};

// "1 / 7d" means nothing without the rule behind it, and the header has no room for it.
const COL_HINTS = {
  "Days active": "Days the ticket has spent in its current status, against the target for that status",
  "CRM ID": "The Sales CRM opportunity id. Blank means the ticket was raised by hand here.",
  "Sales CRM": "The stage in Sales CRM. Reference only — it is not this app's status.",
};

export default function Dashboard({ me, onOpen }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [salesNames, setSalesNames] = useState([]);
  const team = usePnsTeam();

  // Who the tile numbers describe. Separate from the table filters on purpose: you want
  // to see "Niko's book" in the headline numbers while still browsing everything below,
  // and clicking a tile is what pushes that scope down into the table.
  const [scope, setScope] = useState({ owner: "", sales: "" });
  const [all, setAll] = useState([]);
  const [sort, setSort] = useState({ key: "submitted_on", dir: "desc" });

  const toggle = (key, v) =>
    setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));

  const load = useCallback(() => {
    api.tickets({
      search: f.search, status: f.status, service: f.service,
      owner: f.owner, sales: f.sales, stage: f.stage, acct_type: f.acct,
      submitted_from: f.from, submitted_to: f.to,
    }).then((d) => setRows(d.tickets)).catch(() => setRows([]));
  }, [f]);

  const [stageNames, setStageNames] = useState([]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    // One unfiltered fetch feeds the dropdowns and every tile. Holding the whole book
    // here is what lets the tiles re-count instantly as the scope changes, with no
    // round trip per selection.
    api.tickets({}).then((d) => {
      setAll(d.tickets);
      setSalesNames([...new Set(d.tickets.map((t) => t.sales).filter(Boolean))].sort());
      setStageNames([...new Set(d.tickets.map((t) => t.stage).filter(Boolean))].sort());
    }).catch(() => {});
  }, []);

  // Tile counts, scoped by the PIC selectors above them.
  const scoped = useMemo(() => all.filter((t) =>
    (!scope.owner || (scope.owner === "__unassigned__" ? !t.owner : t.owner === scope.owner))
    && (!scope.sales || t.sales === scope.sales)), [all, scope]);

  const counts = useMemo(() => {
    const c = { __acct: {} };
    for (const t of scoped) {
      c[t.status] = (c[t.status] || 0) + 1;
      c.__acct[t.acct_type] = (c.__acct[t.acct_type] || 0) + 1;
    }
    return c;
  }, [scoped]);

  const minePending = useMemo(() => all.filter((t) =>
    (me.group === "PNS" ? t.owner === me.name : t.sales === me.name)
    && t.status.startsWith("Pending")).length, [all, me]);

  // Clicking a tile filters the table to that status and pushes the tile scope down
  // with it, so the table shows exactly the tickets the number counted.
  const tileClick = (status) => {
    const on = f.status.length === 1 && f.status[0] === status;
    setF((p) => ({ ...p, status: on ? [] : [status],
                   owner: on ? "" : scope.owner, sales: on ? "" : scope.sales }));
  };
  const tileOn = (status) => f.status.length === 1 && f.status[0] === status;

  const canSeeMargin = me.permissions.seeMargin;

  // key is what the row is sorted by; label is the header. Order matches how the team
  // reads a row: identify it, then when, then who and what, then where it stands.
  const COLS = [
    ["ref", "Ticket"],
    ["opportunity_id", "CRM ID"],
    ["submitted_on", "Submitted"],
    ["shipper", "Shipper"],
    ["service", "Service"],
    ["revenue", "Revenue", "right"],
    ["status", "Status"],
    ["stage", "Sales CRM"],
    ["sla_elapsed", "Days active"],
    canSeeMargin && ["margin", "Margin", "right"],
    ["owner", "PNS PIC"],
    ["sales", "Sales PIC"],
  ].filter(Boolean);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      // Blanks always sort last, whichever direction — an empty PIC is not "before A".
      if (x == null || x === "") return y == null || y === "" ? 0 : 1;
      if (y == null || y === "") return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * mul;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * mul;
    });
  }, [rows, sort]);

  const clickSort = (key) =>
    setSort((s) => s.key === key
      ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "submitted_on" || key === "revenue" ? "desc" : "asc" });

  const active =
    f.search || f.status.length || f.service.length || f.acct.length || f.owner
    || f.sales || f.stage || f.from || f.to;

  const sel = "rounded-lg border border-slate-300 px-3 py-2 text-[13.5px]";

  // Export exactly what is on screen, and only the columns this role may see — margin
  // stays out of the file for anyone without seeMargin, same rule as the table.
  const exportCsv = () => {
    const head = ["Ticket", "CRM ID", "Submitted", "Shipper", "Account type", "Region",
                  "Service", "Revenue", "Status", "Sales CRM stage", "Priced by",
                  "PNS review", "Days in status", "SLA target",
                  ...(canSeeMargin ? ["Margin %"] : []), "PNS PIC", "Sales PIC"];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")].concat(sorted.map((t) => [
      t.ref, t.opportunity_id || "", t.submitted_on, t.shipper, t.acct_type, t.region,
      t.service, t.revenue, t.status, t.stage || "", t.priced_by,
      t.needs_review ? "yes" : "no", t.sla_elapsed, t.sla_target,
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

  const scopeLabel = scope.owner || scope.sales
    ? `${scope.owner === "__unassigned__" ? "unassigned" : scope.owner || ""}${
        scope.owner && scope.sales ? " + " : ""}${scope.sales || ""}`
    : "everyone";

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

      {/* -------------------------------------------------- tiles and their scope */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          Counting
        </span>
        <select className={sel} value={scope.owner}
          onChange={(e) => setScope({ ...scope, owner: e.target.value })}>
          <option value="">All PNS PICs</option>
          <option value="__unassigned__">Unassigned</option>
          {team.map((n) => <option key={n}>{n}</option>)}
        </select>
        <select className={sel} value={scope.sales}
          onChange={(e) => setScope({ ...scope, sales: e.target.value })}>
          <option value="">All Sales PICs</option>
          {salesNames.map((n) => <option key={n}>{n}</option>)}
        </select>
        <span className="text-[12px] text-slate-500">
          {scoped.length} ticket{scoped.length === 1 ? "" : "s"} for <b>{scopeLabel}</b>
          {" "}· click a box to filter the table to it
        </span>
        {(scope.owner || scope.sales) && (
          <button onClick={() => setScope({ owner: "", sales: "" })}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px]">
            Count everyone
          </button>
        )}
      </div>

      <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(178px,1fr))]">
        {TILES.map(([status, sub]) => (
          <Tile key={status} label={status} value={counts[status] || 0} sub={sub}
                tone={TILE_TONE[status]} on={tileOn(status)}
                onClick={() => tileClick(status)} />
        ))}
      </div>

      {stats && (
        <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
          <Tile label="Waiting on me" value={minePending}
                sub={me.group === "PNS" ? "my assigned, still pending" : "my tickets, still pending"}
                tone={minePending > 0 ? "text-[#EE1B2C]" : "text-emerald-600"} />
          <Tile label="Win rate" value={stats.win_rate === null ? "—" : `${stats.win_rate}%`}
                sub={`${stats.won} won of ${stats.won + stats.lost} decided`}
                tone="text-emerald-600" />
          {/* total_year is a historical field name: the query has no date filter, so
              this is every ticket ever raised. Label it for what it counts. */}
          <Tile label="Total" value={stats.total_year} sub="all time" />
          <Tile label="Showing" value={rows.length} sub={active ? "after filters" : "no filters"} />
        </div>
      )}

      {/* -------------------------------------------------------------- filters */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="search" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })}
            placeholder="Search shipper, ticket or CRM ID…"
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
          <select className={sel} value={f.sales} onChange={(e) => setF({ ...f, sales: e.target.value })}>
            <option value="">Any Sales PIC</option>
            {salesNames.map((n) => <option key={n}>{n}</option>)}
          </select>
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

      {/* ---------------------------------------------------------------- table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {COLS.map(([key, label, align]) => {
                  const on = sort.key === key;
                  return (
                    <th key={key} title={COL_HINTS[label] || `Sort by ${label}`}
                      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className={`whitespace-nowrap px-4 py-3.5 ${align === "right" ? "text-right" : ""}`}>
                      <button onClick={() => clickSort(key)}
                        className={`inline-flex items-center gap-1 hover:text-slate-900 ${
                          on ? "font-bold text-[#EE1B2C]" : ""}`}>
                        {label}
                        <span className={on ? "" : "opacity-25"}>
                          {on ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
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
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[12px] text-slate-500">
                    {t.opportunity_id || <span className="text-slate-300">raised here</span>}
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
                      : "font-normal text-slate-400"}`}>{t.acct_type}</span>
                    <span className="ml-1.5 text-[11.5px] font-normal text-slate-400">{t.region}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">{t.service}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">{rp(t.revenue)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <Pill dot>{t.status}</Pill>
                    {t.needs_review && <span className="ml-1.5 text-[11.5px] text-violet-600">· PNS review</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[12px] text-slate-500">
                    {t.stage || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <Sla elapsed={t.sla_elapsed} target={t.sla_target} />
                  </td>
                  {canSeeMargin && (
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">
                      {t.margin == null ? "—" : `${t.margin}%`}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                    {t.owner || <span className="font-semibold text-amber-600">unassigned</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                    {t.sales || <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-slate-400">
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
