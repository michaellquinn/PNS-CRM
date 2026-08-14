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
  const [days, setDays] = useState(7);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [mode, setMode] = useState("both");   // both | new | refresh | ids
  const [ids, setIds] = useState("");

  // Accept anything paste-shaped: commas, spaces, newlines, one per line from a sheet.
  const idList = ids.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  const run = async (dry, override = {}) => {
    const body = {
      days: mode === "refresh" || mode === "ids" ? 0 : Number(days) || 7,
      pages: mode === "refresh" || mode === "ids" ? 0 : Number(pages) || 0,
      refresh: mode !== "new" && mode !== "ids",
      ids: mode === "ids" ? idList : [],
      dry_run: dry,
      ...override,
    };
    if (!dry && !window.confirm(
      `Run this for real? New opportunities become tickets, and tickets whose Sales CRM ` +
      `opportunity has closed move to Lost or Ready to Ship. Sales CRM is never written to.`))
      return;
    setBusy(true);
    try {
      const d = await api.syncSalesCrm(body);
      setRes(d);
      const moved = (d.refreshed || []).filter((r) => r.moved).length;
      notify(dry
        ? `Dry run: ${d.counts.created} would be created, ${moved} would change status`
        : `${d.counts.created} imported, ${moved} status changes, ${d.counts.refreshed} refreshed`);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const MODES = [
    ["both", "New + refresh", "The routine run: import new opportunities and re-check the ones you already hold."],
    ["new", "New only", "Import only, leave held tickets untouched."],
    ["refresh", "Re-check held tickets only", "No date window at all — re-reads every opportunity behind a ticket you hold, by id, to see whether its Sales CRM stage has moved."],
    ["ids", "These opportunity IDs only", "Paste Sales CRM opportunity ids and import exactly those, nothing else. This is how you rebuild the board deliberately: clear it down, then pull in the deals you actually want."],
  ];
  const modeHint = MODES.find(([v]) => v === mode)[2];

  return (
    <>
      <Head title="Sales CRM sync"
        sub="Reads Sales CRM and writes here. Read-only against Sales CRM: nothing is ever written back." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          {MODES.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] ${mode === v
                ? "border-[#EE1B2C] bg-[#EE1B2C] font-semibold text-white"
                : "border-slate-300 bg-white font-medium text-slate-600 hover:border-slate-400"}`}>
              {label}
            </button>
          ))}
          <p className="w-full text-[11.5px] text-slate-500">{modeHint}</p>
          {mode === "ids" && (
            <div className="w-full">
              <textarea className={`${inputCls} min-h-[84px] font-mono text-[12.5px]`}
                value={ids} onChange={(e) => setIds(e.target.value)}
                placeholder={"Paste Sales CRM opportunity IDs — one per line, or separated by commas\n0067000000123456\n0067000000123457"} />
              <p className="mt-1 text-[11px] text-slate-400">
                Up to 200 at a time. An id that does not exist in Sales CRM is reported in
                the skip list rather than passed over, so a typo cannot look like a deal
                that was filtered out. Ids already imported are refreshed, never duplicated.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Btn onClick={() => run(true)} disabled={busy || (mode === "ids" && !idList.length)}>
            {busy ? "Scanning…" : "Dry run"}
          </Btn>
          <Btn kind="primary" disabled={busy || !res} onClick={() => run(false)}>
            Run for real
          </Btn>
          {mode === "ids" && (
            <span className="text-[12px] text-slate-500">
              {idList.length} id{idList.length === 1 ? "" : "s"} ready
            </span>
          )}
          {mode !== "refresh" && mode !== "ids" && (
            <label className="ml-auto flex items-center gap-2 text-[12px] text-slate-500">
              Last
              <input className={`${inputCls} w-16`} type="number" min="1" max="60"
                value={days} onChange={(e) => setDays(e.target.value)} />
              days
            </label>
          )}
          <p className="w-full text-[11.5px] text-slate-400">
            <b>The day window is the opportunity&rsquo;s creation date, not its last edit.</b>{" "}
            Sales CRM has no filter on when a record was edited, so a deal created two
            months ago and moved to Closed-Won yesterday will never appear in
            &ldquo;last 7 days&rdquo;. That is what <b>Re-check held tickets</b> is for: it
            ignores dates entirely and reads every opportunity behind a ticket you hold,
            by id. Run a dry run first; the real run stays disabled until you have.
          </p>
        </div>

        <details className="border-t border-slate-100 px-4 py-3">
          <summary className="cursor-pointer text-[12px] font-medium text-slate-600">
            Backfill older opportunities
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] text-slate-500">
              Also read
              <input className={`${inputCls} w-16`} type="number" min="0" max="40"
                value={pages} onChange={(e) => setPages(e.target.value)} />
              pages from the newest
            </label>
            <p className="w-full text-[11.5px] text-slate-400">
              Only for a first import. Each page is 100 opportunities and costs a few
              seconds, so a run stops when it runs out of time and tells you. Repeat until
              you have gone back as far as you want. Nothing is duplicated: an opportunity
              already imported is recognised and refreshed rather than created again.
            </p>
          </div>
        </details>
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
            {res.counts.revenue_filled > 0 && (
              <Pill tone="bg-emerald-50 text-emerald-700">
                {res.counts.revenue_filled} {res.dry_run ? "would get" : "got"} their
                {" "}missing revenue
              </Pill>
            )}
            {res.counts.errors > 0 &&
              <Pill tone="bg-rose-50 text-rose-700">{res.counts.errors} errors</Pill>}
            {res.dry_run && <Pill tone="bg-sky-50 text-sky-700">dry run, nothing written</Pill>}
            {res.truncated && (
              <Pill tone="bg-rose-50 text-rose-700">stopped early on time, run it again</Pill>
            )}
            {res.caught_up && !res.truncated && (
              <Pill tone="bg-emerald-50 text-emerald-700">caught up, nothing older to read</Pill>
            )}
          </div>

          {res.truncated && (
            <p className="mb-4 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              The sweep ran out of time and returned what it had. Everything below is
              real, just incomplete. Run it again with fewer pages: the sweep always
              starts from the newest opportunity, so nothing is skipped by stopping.
            </p>
          )}

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
                    {c.acct_type === "Standard"
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
                Every mapped field is re-read, not just a couple: Sales CRM's own facts
                (stage, committed revenue, close date, lead source) overwrite ours, and
                everything else — volume, destination, contact, go-live — fills a blank
                only, because PNS corrects those here deliberately. A <b>closed</b> stage
                also moves our status: Closed-Lost and Future Opportunity become Lost;
                the accepted stages become Ready to Ship, and if the onboarding fields are
                still blank, PNS and Sales are told which ones. Service and account tier
                are still left alone.
                <br />
                <b>Potential revenue</b> is filled in when ours is still 0 and Sales CRM
                now has a figure — that is filling a gap, not overwriting a correction —
                and the routing is re-derived with it.
              </p>
            </div>
            <Table head={["Opportunity", "Name", "Sales CRM stage", "Our status"]}
              rows={res.refreshed || []}
              empty="No held tickets were re-read in this run."
              render={(r, idx) => (
                <tr key={`${r.id}-${idx}`} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{r.id}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.name || "—"}</td>
                  <td className="px-4 py-2.5">{r.stage}</td>
                  <td className="px-4 py-2.5">
                    {r.revenue_filled > 0 && (
                      <Pill tone="bg-emerald-50 text-emerald-700">
                        revenue {res.dry_run ? "would be set" : "set"} to {rp(r.revenue_filled)}
                      </Pill>
                    )}{" "}
                    {r.moved ? (
                      <>
                        <Pill tone={r.moved === "Lost"
                          ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}>
                          {res.dry_run ? "would move to " : "moved to "}{r.moved}
                        </Pill>
                        {r.missing?.length > 0 && (
                          <span className="ml-2 text-[11.5px] text-amber-700">
                            still blank: {r.missing.join(", ")}
                          </span>
                        )}
                      </>
                    ) : <span className="text-slate-400">unchanged</span>}
                  </td>
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

          {/* "Are we syncing everything we could?" was previously answerable only by
              opening a record in Sales CRM and comparing by eye. This is the same
              question answered from the data: fields the API actually returned that
              nothing in this app reads yet. */}
          <Card className="mb-4">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">
                Fields Sales CRM sends that we do not read yet
              </h2>
              <p className="text-[12px] text-slate-500">
                Everything mapped lands in the intake, and the whole raw record is kept on
                each ticket under <b>Sales CRM record</b> — so nothing is lost either way.
                This list is what to map next: a field on nearly every opportunity is
                worth a place on the form, one that appears twice is probably not.
              </p>
            </div>
            <Table head={["Sales CRM field", "Seen on"]} rows={res.unmapped || []}
              empty="Nothing unread — every field on the records in this run is mapped."
              render={(f, idx) => (
                <tr key={`${f.field}-${idx}`} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{f.field}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600">
                    {f.seen} of {res.scanned} records
                  </td>
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
