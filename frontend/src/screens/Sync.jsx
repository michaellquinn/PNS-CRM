import { useEffect, useState } from "react";
import { api, WATCHED_GROUPS, rp } from "../api";
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
  const [auto, setAuto] = useState(null);
  const [groups, setGroups] = useState([]);   // [] = every group

  // The timer is the thing most likely to be quietly broken — the Sales CRM key expires
  // about every 30 days and an automatic run has nobody watching it. So its last result
  // is read on load and shown at the top, failure first.
  useEffect(() => { api.autoSync().then(setAuto).catch(() => setAuto(null)); }, []);

  // Accept anything paste-shaped: commas, spaces, newlines, one per line from a sheet.
  const idList = ids.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  const run = async (dry, override = {}) => {
    const body = {
      days: mode === "refresh" || mode === "ids" ? 0 : Number(days) || 7,
      pages: mode === "refresh" || mode === "ids" ? 0 : Number(pages) || 0,
      // ids mode refreshes too: naming an id you already hold is a request to re-read
      // that deal, and it used to send refresh:false so those ids were skipped.
      refresh: mode !== "new",
      ids: mode === "ids" ? idList : [],
      groups,
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
    ["ids", "These opportunity IDs only", "Paste Sales CRM opportunity ids and handle exactly those, nothing else — imported if new, re-read if you already hold them. The quickest way to pull one deal back into line after a rule change, without waiting for the rotating refresh to reach it."],
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
          {/* Narrow a run to the deals somebody is actually asked about in a meeting.
              Sales CRM has no field for any of the three — the account tier is resolved
              by walking up to the parent group, Must Win is a Lead Source Detail value —
              so this is applied after each account is read, not sent as a query. That
              makes a scoped run cheaper in tickets touched, not in API calls. */}
          {mode !== "ids" && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Limit to
              </span>
              {WATCHED_GROUPS.map((g) => {
                const on = groups.includes(g.id);
                return (
                  <button key={g.id} type="button" aria-pressed={on}
                    onClick={() => setGroups(on ? groups.filter((x) => x !== g.id)
                                                 : [...groups, g.id])}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                      on ? "border-transparent " + g.tone + " ring-2 ring-slate-900/20"
                         : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                    {g.label}
                  </button>
                );
              })}
              <span className="text-[11.5px] text-slate-500">
                {groups.length === 0
                  ? "Every group, including Standard — the routine run."
                  : `Only ${groups.join(", ")}. Everything else is skipped with that reason, and held tickets outside these groups are not re-read either.`}
              </span>
              {groups.length > 0 && (
                <Btn onClick={() => setGroups([])}>All groups</Btn>
              )}
            </div>
          )}
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
            <b>Nothing raised before 1 August 2026 is imported</b>, whatever window you
            ask for — that floor holds even on a wide manual run or a backfill, so one
            careless &ldquo;last 60 days&rdquo; cannot pull in the whole history of the
            book. Tickets you already hold are still refreshed whatever their date, which
            is how they learn their opportunity closed.
            <br />
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

      {auto && (
        <Card className={`mb-4 border-l-4 p-4 ${
          !auto.enabled ? "border-l-slate-300"
            : auto.last_ok === false ? "border-l-rose-500 bg-rose-50/60"
            : "border-l-emerald-400"}`}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
              Automatic sync
            </span>
            {auto.enabled
              ? <Pill tone="bg-emerald-50 text-emerald-700">
                  on · every {auto.every_minutes} min
                </Pill>
              : <Pill tone="bg-slate-100 text-slate-600">off</Pill>}
            {auto.last_ok === false && (
              <Pill tone="bg-rose-100 text-rose-800">last run FAILED</Pill>
            )}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
            {!auto.enabled ? (
              <>Nothing runs on its own. Set <code className="font-mono">AUTO_SYNC_MINUTES</code>{" "}
              in the portal to switch it on.</>
            ) : auto.last_at ? (
              <>
                Last run <b>{auto.last_at}</b>
                {auto.last_ok
                  ? <> — {auto.last_counts
                      ? `${auto.last_counts.created} created, ${auto.last_counts.refreshed} refreshed`
                      : "no changes"}. {auto.runs} run{auto.runs === 1 ? "" : "s"} since restart.</>
                  : <> — <b className="text-rose-700">{auto.last_error}</b></>}
              </>
            ) : (
              <>On, but it has not run yet since this deployment. The first run is 30 seconds after start-up.</>
            )}
          </p>
          {auto.last_ok === false && (
            <p className="mt-1.5 text-[12.5px] text-rose-800">
              The commonest cause is the Sales CRM API key expiring — they last about 30
              days and are issued per person. Reissue it and update{" "}
              <code className="font-mono">SALESCRM_API_KEY</code> in the portal. Until
              then nothing is arriving automatically and the book is going stale.
            </p>
          )}
        </Card>
      )}

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
                <b>Sales CRM always takes priority</b> (Baskoro, 2026-08-14). Every field
                it carries is overwritten here — including potential revenue, service line
                and account tier, which used to be left alone. A correction made in this
                app to any of them survives only until the next run; if it is wrong, fix
                it in Sales CRM. Since 18 August the go-live date comes from Sales CRM's
                <i>target start date</i> rather than its close date — the field that
                actually answers the question. A <b>closed</b> stage
                also moves our status: Closed-Lost becomes Lost; the accepted stages
                become Ready to Ship, and if the onboarding fields are still blank,
                PNS and Sales are told which ones. <b>Future Opportunity</b> is a
                park, not a loss — since 31 August it leaves our status alone, so the
                ticket keeps its place and carries on by itself when Sales moves the
                stage. A price cannot be attached while it is parked.
                Service and account tier
                <br />
                Whenever revenue, service or tier changes, the <b>routing is re-derived</b>
                on the corrected facts and the change is written to the ticket history,
                so nobody has to work out why a deal moved sides.
              </p>
            </div>
            <Table head={["Opportunity", "Name", "Sales CRM stage", "Our status", "Overwritten"]}
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
                  <td className="px-4 py-2.5 text-[12px] text-slate-600">
                    {r.overwritten?.length
                      ? r.overwritten.join("; ")
                      : <span className="text-slate-400">nothing</span>}
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
