import { useEffect, useState } from "react";
import { api, WATCHED_GROUPS, groupTone, rp } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

// A ticket is one opportunity and always will be — that is the level Sales CRM works at
// and the level a solution is actually built and priced at. But Sales CRM may create a
// different Account record and parent for each opportunity from the same real shipper.
// A flat list therefore splits one customer into several cards.
//
// So the same tickets are served grouped as well as flat (GET /api/accounts). Nothing is
// stored twice; this is a second reading of the same rows.

function Row({ a, onOpen }) {
  const [open, setOpen] = useState(false);
  const sources = a.source_accounts || [];
  // The fallback keeps the screen honest for a cached/older API response while a deploy
  // rolls from one backend replica to the next.
  const linkedSources = sources.length
    ? sources.filter((s) => s.account_id)
    : (a.account_id ? [a] : []);
  const grouped = sources.length > 1;
  return (
    <Card>
      <button onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="w-4 shrink-0 text-center text-slate-400">{open ? "▾" : "▸"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[14px]">{a.shipper}</b>
            {a.group && <Pill tone={groupTone(a.group)}>{a.group}</Pill>}
            {grouped && (
              <Pill tone="bg-sky-50 text-sky-700">
                {sources.length} CRM accounts grouped by name
              </Pill>
            )}
            {linkedSources.length === 0 && (
              // No Sales CRM account id means this shipper only exists here — it was
              // typed by hand and never matched to an account. Worth seeing: account
              // totals for it can never be complete.
              <Pill tone="bg-amber-50 text-amber-700">not linked to Sales CRM</Pill>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {a.tickets.length} ticket{a.tickets.length === 1 ? "" : "s"}
            {" · "}{a.open_tickets} live
            {a.won > 0 && <> · {a.won} won</>}
            {a.lost > 0 && <> · {a.lost} lost</>}
            {a.services.length > 0 && <> · {a.services.join(", ")}</>}
            {a.sales.length > 0 && <> · sales {a.sales.join(", ")}</>}
            {a.owners.length > 0 && <> · PNS {a.owners.join(", ")}</>}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[14px] font-bold tabular-nums">{rp(a.total_revenue)}</div>
          <div className="text-[11px] text-slate-400">live potential / month</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {grouped ? (
            <div className="mb-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3">
              <p className="mb-2 text-[11.5px] text-slate-600">
                Grouped by the shared base shipper name for this view only. Each CRM
                account keeps its own parent, tier and ticket routing.
              </p>
              <div className="flex flex-col gap-1.5">
                {sources.map((s) => (
                  <div key={s.shipper_id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                    <span className="font-medium text-slate-700">{s.shipper}</span>
                    {s.account_url ? (
                      <a href={s.account_url} target="_blank" rel="noopener noreferrer"
                        className="text-sky-700 hover:underline">
                        CRM account {s.account_id} ↗
                      </a>
                    ) : (
                      <span className="text-amber-700">not linked to Sales CRM</span>
                    )}
                    {s.parent_account_id && (
                      <span className="text-slate-500">
                        parent{" "}
                        {s.parent_account_url ? (
                          <a href={s.parent_account_url} target="_blank" rel="noopener noreferrer"
                            className="text-sky-700 hover:underline">
                            {s.parent_account_name || s.parent_account_id} ↗
                          </a>
                        ) : (s.parent_account_name || s.parent_account_id)}
                      </span>
                    )}
                    <Pill tone={groupTone(s.acct_type)}>{s.acct_type}</Pill>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {a.account_url && (
              <a href={a.account_url} target="_blank" rel="noopener noreferrer"
                className="text-sky-700 hover:underline">
                Open account {a.account_id} in Sales CRM ↗
              </a>
            )}
            {/* The account GROUP. Hypercare and Strategic are inherited from the parent,
                so an account whose parent you cannot open is one whose tier this screen
                cannot explain. It was a bare grey id until 2026-08-14. */}
            {a.parent_account_id && (
              <span className="text-slate-500">
                Part of{" "}
                {a.parent_account_url ? (
                  <a href={a.parent_account_url} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-sky-700 hover:underline">
                    {a.parent_account_name || `account group ${a.parent_account_id}`} ↗
                  </a>
                ) : (
                  <b>{a.parent_account_name || a.parent_account_id}</b>
                )}
                {a.siblings_in_group > 0 && (
                  <> · {a.siblings_in_group} other{a.siblings_in_group === 1 ? "" : "s"} in the group</>
                )}
              </span>
            )}
          </p>}
          {a.tickets.map((t) => (
            <div key={t.ref}
              className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2 last:border-0">
              <button onClick={() => onOpen(t.ref)}
                className="font-mono text-[12.5px] font-bold text-[#EE1B2C] hover:underline">
                {t.ref}
              </button>
              <Pill dot>{t.status}</Pill>
              {t.must_win && <Pill tone={groupTone("Must Win")}>Must Win</Pill>}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">
                {t.opportunity_name || t.service}
              </span>
              <span className="text-[12px] text-slate-500">{t.service}</span>
              <span className="font-mono text-[12px] tabular-nums text-slate-600">
                {rp(t.revenue)}
              </span>
              <span className="w-32 truncate text-[11.5px] text-slate-400">
                {t.owner || "PNS unassigned"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Accounts({ onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [group, setGroup] = useState("");
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(true);

  useEffect(() => {
    setData(null);
    api.accounts({ group, open_only: openOnly || undefined })
      .then((d) => setData(d.accounts)).catch((e) => setErr(e.message));
  }, [group, openOnly]);

  const needle = q.trim().toLowerCase();
  const list = (data || []).filter((a) => {
    if (!needle) return true;
    const names = [a.shipper, ...(a.source_accounts || []).map((s) => s.shipper)];
    return names.some((name) => (name || "").toLowerCase().includes(needle));
  });

  return (
    <>
      <Head title="Accounts"
        sub="The same tickets, grouped by their shared base shipper name even when Sales CRM created different accounts or parents for the opportunities. This view never changes the original CRM records or ticket routing."
        right={data && <span className="text-[12px] text-slate-500">{list.length} accounts</span>}
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search account…"
          className="min-w-[190px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]" />
        <select className={`${inputCls} max-w-[180px]`} value={group}
          onChange={(e) => setGroup(e.target.value)}>
          <option value="">Every account</option>
          {WATCHED_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Only accounts with something live
        </label>
        <Btn onClick={() => { setQ(""); setGroup(""); setOpenOnly(true); }}>Clear</Btn>
      </Card>

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}
      {data === null && !err && <p className="text-sm text-slate-400">Loading…</p>}
      {data && list.length === 0 && <Empty>No accounts match that.</Empty>}
      {list.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {list.map((a) => <Row key={a.shipper_id} a={a} onOpen={onOpen} />)}
        </div>
      )}
    </>
  );
}
