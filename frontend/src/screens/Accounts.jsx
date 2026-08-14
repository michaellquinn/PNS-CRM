import { useEffect, useState } from "react";
import { api, WATCHED_GROUPS, groupTone, rp } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

// A ticket is one opportunity and always will be — that is the level Sales CRM works at
// and the level a solution is actually built and priced at. But nobody manages a shipper
// one opportunity at a time: the tier is an account fact, the relationship is an account
// fact, and a flat list of per-deal tickets makes one account with four live deals look
// like four unrelated shippers. At a glance it also looks exactly like duplicates, which
// is what sent people looking for a bug that was not there.
//
// So the same tickets are served grouped as well as flat (GET /api/accounts). Nothing is
// stored twice; this is a second reading of the same rows.

function Row({ a, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="w-4 shrink-0 text-center text-slate-400">{open ? "▾" : "▸"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[14px]">{a.shipper}</b>
            {a.group && <Pill tone={groupTone(a.group)}>{a.group}</Pill>}
            {!a.account_id && (
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
          {a.account_url && (
            <p className="mb-2.5 text-[12px]">
              <a href={a.account_url} target="_blank" rel="noopener noreferrer"
                className="text-sky-700 hover:underline">
                Open account {a.account_id} in Sales CRM
              </a>
              {a.parent_account_id && (
                <span className="text-slate-400"> · parent {a.parent_account_id}</span>
              )}
            </p>
          )}
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

  const list = (data || []).filter(
    (a) => !q.trim() || a.shipper.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <Head title="Accounts"
        sub="The same tickets, grouped by the account they belong to. One account normally runs several opportunities at once — that is not duplication, it is the shape of the business. Genuine duplicates are on Reference / Data checks."
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
