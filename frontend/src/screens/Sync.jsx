import { useState } from "react";
import { api, rp } from "../api";
import { Btn, Card, Head, Pill, inputCls } from "../ui";

// Manual sync. Dry run is the default and the destructive button is deliberately the
// second one you reach: the point of this screen is to look at what would happen before
// anything is written.

function Table({ head, rows, render, empty }) {
  if (!rows.length) return <p className="px-4 py-5 text-[13px] text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            {head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2.5">{h}</th>)}
          </tr>
        </thead>
        <tbody>{rows.map(render)}</tbody>
      </table>
    </div>
  );
}

export default function Sync({ notify }) {
  const [pages, setPages] = useState(3);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const run = async (dry) => {
    if (!dry && !window.confirm(
      `Import ${res ? res.counts.created : "the listed"} opportunities as real tickets? ` +
      `This writes to Solutions CRM. Sales CRM is never written to.`)) return;
    setBusy(true);
    try {
      const d = await api.syncSalesCrm({ pages: Number(pages) || 3, dry_run: dry });
      setRes(d);
      notify(dry
        ? `Dry run: ${d.counts.created} would be created, ${d.counts.skipped} skipped`
        : `Imported ${d.counts.created} tickets`);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Head title="Sales CRM sync"
        sub="Walks the newest-first opportunity list and stops at the first one already imported. Read-only against Sales CRM — nothing is ever written back." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-[12.5px]">
            <span className="mb-1 block text-slate-500">Pages to scan (100 each)</span>
            <input className={`${inputCls} w-28`} type="number" min="1" max="20"
              value={pages} onChange={(e) => setPages(e.target.value)} />
          </label>
          <Btn onClick={() => run(true)} disabled={busy}>
            {busy ? "Scanning…" : "Dry run"}
          </Btn>
          <Btn kind="primary" disabled={busy || !res || !res.counts.created}
            onClick={() => run(false)}>
            Import for real
          </Btn>
          <p className="w-full text-[11.5px] text-slate-400">
            Run a dry run first — &ldquo;Import for real&rdquo; stays disabled until you have.
            The sync only you can run: the Sales CRM key is issued per person and reads
            with that person&apos;s permissions.
          </p>
        </div>
      </Card>

      {res && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill tone="bg-slate-100 text-slate-600">{res.scanned} scanned</Pill>
            <Pill tone="bg-emerald-50 text-emerald-700">
              {res.counts.created} {res.dry_run ? "would be created" : "created"}
            </Pill>
            <Pill tone="bg-violet-50 text-violet-700">
              {res.counts.refreshed} {res.dry_run ? "would refresh" : "refreshed"}
            </Pill>
            <Pill tone="bg-amber-50 text-amber-700">{res.counts.skipped} skipped</Pill>
            {res.counts.errors > 0 &&
              <Pill tone="bg-rose-50 text-rose-700">{res.counts.errors} errors</Pill>}
            {res.dry_run && <Pill tone="bg-sky-50 text-sky-700">dry run — nothing written</Pill>}
          </div>

          <Card className="mb-4">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">
                {res.dry_run ? "Would be created" : "Created"}
              </h2>
            </div>
            <Table
              head={["Opportunity", "Shipper", "Service", "Tier", "Revenue", "Routes to", "Ticket"]}
              rows={res.created} empty="Nothing new to import."
              render={(c) => (
                <tr key={c.opportunity_id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{c.opportunity_id}</td>
                  <td className="px-4 py-2.5">{c.shipper}</td>
                  <td className="px-4 py-2.5">{c.service}</td>
                  <td className="px-4 py-2.5">
                    {c.acct_type === "Non-Strategic"
                      ? <span className="text-slate-500">{c.acct_type}</span>
                      : <Pill tone="bg-fuchsia-50 text-fuchsia-700">{c.acct_type}</Pill>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {c.revenue ? rp(c.revenue)
                      : <span className="text-amber-700">no revenue</span>}
                  </td>
                  <td className="px-4 py-2.5">{c.routes_to}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{c.ref || "—"}</td>
                </tr>
              )} />
          </Card>

          <Card className="mb-4">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">
                Already imported &mdash; {res.dry_run ? "would refresh" : "refreshed"} from Sales CRM
              </h2>
              <p className="text-[12px] text-slate-500">
                Stage, committed revenue and close date are re-copied. Potential revenue,
                service and account tier are left alone &mdash; PNS corrects those here
                on purpose and an overwrite would undo it.
              </p>
            </div>
            <Table head={["Opportunity", "Name", "Sales CRM stage"]} rows={res.refreshed || []}
              empty="Nothing already imported in this range."
              render={(r, idx) => (
                <tr key={`${r.id}-${idx}`} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{r.id}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.name || "—"}</td>
                  <td className="px-4 py-2.5">{r.stage}</td>
                </tr>
              )} />
          </Card>

          <Card className="mb-4">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">Skipped, with the reason</h2>
              <p className="text-[12px] text-slate-500">
                Nothing is dropped silently. A skip here is a decision, not a failure.
              </p>
            </div>
            <Table head={["Opportunity", "Name", "Why"]} rows={res.skipped}
              empty="Nothing skipped."
              render={(s, idx) => (
                <tr key={`${s.id}-${idx}`} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{s.id}</td>
                  <td className="px-4 py-2.5 text-slate-600">{s.name || "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.why}</td>
                </tr>
              )} />
          </Card>

          {res.errors.length > 0 && (
            <Card>
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-[13.5px] font-semibold text-rose-700">Errors</h2>
                <p className="text-[12px] text-slate-500">
                  These were left alone — one bad opportunity does not stop the sweep.
                </p>
              </div>
              <Table head={["Opportunity", "Name", "Error"]} rows={res.errors} empty=""
                render={(e, idx) => (
                  <tr key={`${e.id}-${idx}`} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-mono text-[12px]">{e.id}</td>
                    <td className="px-4 py-2.5 text-slate-600">{e.name || "—"}</td>
                    <td className="px-4 py-2.5 text-rose-700">{e.error}</td>
                  </tr>
                )} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
