import { useEffect, useState } from "react";
import { api, BOTTOM_MARGIN, PENDING, PICKABLE_LOSS_REASONS, SERVICES, FTL,
         WATCHED_GROUPS, groupFilter, groupTone, mayGoToPsp, rp } from "../api";
import {
  Btn, Card, Confirm, Empty, Head, MultiSelect, Pill, PriceChip, TicketCard, inputCls,
  usePnsTeam,
} from "../ui";

function useTickets(filters, dep = []) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const reload = () =>
    api.tickets(filters).then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, dep);
  return [rows, err, reload];
}

// Queue-local filtering. These lists are already scoped by status, so a search box and
// a couple of dropdowns beat sending every keystroke back to the server. Every queue
// carries the PNS PIC filter: PNS works by ticket assignment, so "just my tickets" has
// to be one click away wherever a list appears.
// Every filter except the search box holds an ARRAY (Michael, 2026-08-18). One value at
// a time is the wrong shape for the question people bring to a queue: "show me LTL and
// B2BR", "Annisa's and Ramdhani's", "Hypercare and Must Win". An empty array means no
// filter, so the tests for it read the same as the old truthiness checks did.
function useFilter(rows, extra = {}) {
  const base = { q: "", service: [], owner: [], group: [], ...extra };
  const [f, setF] = useState(base);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const patch = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const clear = () => setF(base);
  const out = (rows || []).filter((t) => {
    const q = f.q.trim().toLowerCase();
    if (q && !`${t.ref} ${t.shipper}`.toLowerCase().includes(q)) return false;
    if (f.service.length && !f.service.includes(t.service)) return false;
    if (f.resp?.length && !f.resp.includes(t.priced_by)) return false;
    // __none__ is a real choice, not the absence of one, so it lives in the array beside
    // the names and can be combined with them: "unassigned, or Annisa's".
    if (f.owner.length
        && !f.owner.some((o) => (o === "__none__" ? !t.owner : t.owner === o))) return false;
    // t.group is the server's big_group(): the account tier where there is one, else
    // Must Win, else null. Filtering on it here rather than on acct_type is what makes
    // one control cover all three — Must Win is not an account tier and never appears
    // in acct_type at all.
    if (f.group.length
        && !f.group.some((g) => (g === "__standard__" ? !t.group : t.group === g))) return false;
    return true;
  });
  return [out, f, set, clear, patch];
}

// sections for MultiSelect from a flat list of values, with the toggle wired to `patch`.
const pickList = (values, chosen, apply, labelOf = (v) => v, countOf) => [{
  label: null,
  items: values.map((v) => ({
    key: v, label: labelOf(v), on: chosen.includes(v), n: countOf?.(v),
    toggle: () => apply(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]),
  })),
}];

// The watched groups as a row of toggles, on every queue. Baskoro asked for this as a
// submenu (2026-08-14) and it is both: the sidebar has an entry per group that opens a
// dedicated screen, and every queue carries the same three toggles so you can narrow the
// list you are already looking at without navigating away.
function GroupChips({ value, onPick, counts }) {
  const chip = (id, label, tone) => {
    const on = value.includes(id);
    const n = counts?.[id];
    return (
      <button key={id} type="button" aria-pressed={on}
        onClick={() => onPick(on ? value.filter((x) => x !== id) : [...value, id])}
        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
          on ? "border-transparent " + tone + " ring-2 ring-slate-900/20"
             : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
        {label}{n != null && <span className="ml-1.5 font-mono tabular-nums opacity-70">{n}</span>}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {WATCHED_GROUPS.map((g) => chip(g.id, g.label, g.tone))}
      {chip("__standard__", "Standard", "bg-slate-200 text-slate-700")}
    </div>
  );
}

function FilterBar({ f, set, clear, patch, me, shown, total, rows, groups = true, children }) {
  const team = usePnsTeam();
  const mineOn = me && f.owner.includes(me.name);
  // Counted off the unfiltered list, so a chip reading 0 tells you the queue holds none
  // of that group rather than that your other filters hid them.
  const counts = {};
  (rows || []).forEach((t) => {
    const k = t.group || "__standard__";
    counts[k] = (counts[k] || 0) + 1;
  });
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-3">
      <input type="search" value={f.q} onChange={set("q")} placeholder="Search shipper or ID…"
        className="min-w-[190px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]" />
      <MultiSelect label="Service" picked={f.service}
        onClear={() => patch("service", [])}
        sections={pickList(SERVICES, f.service, (v) => patch("service", v))} />
      <MultiSelect label="PNS PIC" picked={f.owner}
        onClear={() => patch("owner", [])}
        sections={pickList(["__none__", ...team], f.owner, (v) => patch("owner", v),
                           (v) => (v === "__none__" ? "Unassigned" : v))} />
      {me && team.includes(me.name) && patch && (
        <button type="button" aria-pressed={mineOn}
          onClick={() => patch("owner", mineOn
            ? f.owner.filter((x) => x !== me.name)
            : [...f.owner, me.name])}
          className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
            mineOn ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
                   : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
          Assigned to me
        </button>
      )}
      {children}
      <span className="text-[12px] text-slate-500">{shown} of {total}</span>
      <Btn onClick={clear}>Clear</Btn>
      {groups && patch && (
        <div className="flex w-full flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Watched
          </span>
          <GroupChips value={f.group} onPick={(v) => patch("group", v)} counts={counts} />
        </div>
      )}
    </Card>
  );
}

// PNS assignment, inline on any queue card. Assignment is the team's own now, not the
// Head's alone (Baskoro, 2026-08-14, for the PNS-first rollout): the point of putting it
// here rather than only on the ticket detail is that taking a ticket should cost one
// click from the list you are already reading.
export function OwnerBar({ t, me, onDone, notify }) {
  const team = usePnsTeam();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  if (!me.permissions.assign) {
    return (
      <span className="text-[12px] text-slate-500">
        PNS PIC: {t.owner || <span className="font-semibold text-amber-600">unassigned</span>}
      </span>
    );
  }
  const run = async (owner, msg) => {
    setBusy(true);
    try { await api.assign(t.ref, { owner }); notify(msg); await onDone(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  const mine = t.owner === me.name;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-slate-500">
        PNS PIC: <b className={t.owner ? "" : "text-amber-600"}>{t.owner || "unassigned"}</b>
      </span>
      {!mine && (
        <Btn disabled={busy} onClick={() => run(me.name, `${t.ref} is yours`)}>
          {t.owner ? "Take over" : "Take this"}
        </Btn>
      )}
      {mine && (
        <Btn disabled={busy} onClick={() => run("", `${t.ref} put back`)}>
          Put back
        </Btn>
      )}
      <select className={`${inputCls} max-w-[170px]`} value={pick}
        onChange={(e) => setPick(e.target.value)}>
        <option value="">Hand over to…</option>
        {team.filter((n) => n !== t.owner).map((n) => <option key={n}>{n}</option>)}
      </select>
      <Btn disabled={busy || !pick} onClick={() => run(pick, `${t.ref} handed to ${pick}`)}>
        Hand over
      </Btn>
    </div>
  );
}

function Shell({ title, sub, right, rows, err, empty, bar, filtered, children }) {
  const list = filtered ?? rows;
  return (
    <>
      <Head title={title} sub={sub} right={right} />
      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}
      {rows === null && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length > 0 && bar}
      {rows && rows.length === 0 && <Empty>{empty}</Empty>}
      {rows && rows.length > 0 && list.length === 0 && <Empty>Nothing matches those filters.</Empty>}
      {list && list.length > 0 && <div className="flex flex-col gap-3">{children(list)}</div>}
    </>
  );
}

// Sameday has no rate-card link to point at, so the base rate is stated here directly
// rather than being one more thing to look up while pricing.
const SAMEDAY_RATE = "Regular Rp 20.000 / 5kg · Premium Rp 35.000 / 5kg";
const WEB_PRICING_URL = "https://web-pricing.ninjavan.apps.substrait.build";
const LINKED_SERVICES = ["LTL", "B2BR"];

function RateCard({ service }) {
  const linked = LINKED_SERVICES.includes(service);
  const heading = <b className="underline decoration-slate-300 underline-offset-2">Rate card — {service}</b>;
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px]">
      <span className="opacity-60">🔗</span>
      <div>
        {linked ? (
          <a href={WEB_PRICING_URL} target="_blank" rel="noopener noreferrer" className="hover:no-underline">
            {heading}
          </a>
        ) : heading}
        <p className="text-[11.5px] text-slate-500">
          {service === "Sameday" ? SAMEDAY_RATE
            : linked ? "Opens the pricing tool in a new tab."
            : "Build the price from the published card."}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- awaiting price */
export function AwaitingPrice({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ awaiting: true });
  const [file, setFile] = useState({});
  const [link, setLink] = useState({});
  const [below, setBelow] = useState({});
  const [margin, setMargin] = useState({});
  const [disc, setDisc] = useState({});
  const [busy, setBusy] = useState(null);
  const [list, f, set, clear, patch] = useFilter(rows, { resp: [] });

  // Anyone may look at this queue; only the sides that owe prices get the form.
  const canAct = ["PNS", "Commercial", "Admin"].includes(me.group);

  const act = async (ref, fn) => {
    setBusy(ref);
    try { await fn(); notify("Done"); await reload(); }
    catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  return (
    <Shell
      title="Awaiting price"
      sub="The responsible party attaches the price. Always build it from the linked rate card."
      right={<span className="text-[12px] text-slate-500">
        {me.group === "PNS" ? "PNS-priced tickets" : me.group === "Commercial" ? "Tickets you must price" : "All tickets"}
      </span>}
      rows={rows} err={err} empty="Nothing awaiting a price."
      bar={
        <FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
          shown={list.length} total={(rows || []).length} rows={rows}>
          <MultiSelect label="Priced by" picked={f.resp}
            onClear={() => patch("resp", [])}
            sections={pickList(["PNS", "Sales"], f.resp, (v) => patch("resp", v))} />
        </FilterBar>
      }
      filtered={list}
    >
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[
            <Pill key="by" tone={t.priced_by === "PNS" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}>
              Priced by {t.priced_by}
            </Pill>,
            t.needs_review && <Pill key="r" tone="bg-violet-50 text-violet-700">PNS review after</Pill>,
            t.psp_ready && <Pill key="psp" tone="bg-emerald-50 text-emerald-700">PSP approved</Pill>,
          ].filter(Boolean)}
        >
          {!canAct ? (
            <p className="text-[12.5px] text-slate-500">
              View only — {t.priced_by === "PNS" ? "PNS" : "Sales"} attaches the price here.
              {(t.price_file || t.price_url) && <> Currently attached: <PriceChip file={t.price_file} url={t.price_url} /></>}
            </p>
          ) : t.psp_ready ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-slate-600">
                PSP approved this margin. The price and link don't change — confirm and
                the proposal goes out.
              </p>
              <Btn kind="primary" className="ml-auto" disabled={busy === t.ref}
                onClick={() => act(t.ref, () => api.submitProposal(t.ref))}>
                Submit proposal
              </Btn>
            </div>
          ) : (
            <>
          <RateCard service={t.service} />
          {(t.price_file || t.price_url) && (
            <p className="mb-3 text-[12.5px]">
              <span className="text-slate-500">Currently attached: </span>
              <PriceChip file={t.price_file} url={t.price_url} />
            </p>
          )}
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <input className={inputCls} type="url" inputMode="url"
              placeholder="Link to the pricing spreadsheet — https://docs.google.com/spreadsheets/…"
              value={link[t.ref] ?? ""} onChange={(e) => setLink({ ...link, [t.ref]: e.target.value })} />
            <input className={inputCls} placeholder="Label (optional)"
              value={file[t.ref] ?? ""} onChange={(e) => setFile({ ...file, [t.ref]: e.target.value })} />
          </div>
          <p className="mb-3 text-[11px] text-slate-400">
            Share the sheet with whoever needs it in Drive first; this app stores the link
            and cannot grant access. Keep cost and margin workings out of any sheet a
            shipper or Commercial will open.
          </p>
          {/* The 5A tier ceiling is checked against these. Leaving one blank is not a
              breach, since a standard rate card has nothing to declare, but then
              nothing is checked either. */}
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className={inputCls} type="number" step="0.1" min="0" max="100"
              placeholder="Margin % (leave blank if standard)"
              value={margin[t.ref] ?? ""}
              onChange={(e) => setMargin({ ...margin, [t.ref]: e.target.value })} />
            <input className={inputCls} type="number" step="0.1" min="0" max="100"
              placeholder="Discount % (leave blank if none)"
              value={disc[t.ref] ?? ""}
              onChange={(e) => setDisc({ ...disc, [t.ref]: e.target.value })} />
          </div>
          {BOTTOM_MARGIN[t.service] != null && (
            <p className="mb-2 text-[11px] text-slate-400">
              {t.service} floor is {BOTTOM_MARGIN[t.service]}%, so a margin of{" "}
              {Math.max(0, BOTTOM_MARGIN[t.service] - 1)}% would be below it.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {BOTTOM_MARGIN[t.service] != null && (
              <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[12.5px] font-medium text-amber-800">
                <input type="checkbox" checked={!!below[t.ref]}
                  onChange={(e) => setBelow({ ...below, [t.ref]: e.target.checked })} />
                Below bottom rate ({BOTTOM_MARGIN[t.service]}% floor)
              </label>
            )}
            {/* A button, not a checkbox tied to Attach price: escalating is its own
                immediate action, not something that only takes effect once the price
                form is also filled in and submitted — so it shows up on PSP's Pending
                queue the moment it's clicked, whether or not a price exists yet.
                PSP only takes managed accounts, or a ticket the PNS Head has opened on
                Alex's exception. Offering it otherwise invites a 400. */}
            {me.permissions.sendToPsp && mayGoToPsp(t) && (
              <Btn onClick={() => act(t.ref, () => api.status(t.ref,
                { status: "Pending Review - PSP", reason: "escalated for a second opinion" }))}>
                Escalate to PSP
              </Btn>
            )}
            {/* Vendor cost is an FTL-only detour; nothing else is priced through a vendor. */}
            {me.permissions.vendorToggle && FTL.includes(t.service) && t.status !== "Pending Vendor" && (
              <Btn onClick={() => act(t.ref, () => api.status(t.ref, { status: "Pending Vendor", reason: "waiting on vendor cost" }))}>
                Waiting vendor cost
              </Btn>
            )}
            {me.permissions.vendorToggle && FTL.includes(t.service) && t.status === "Pending Vendor" && (
              <Btn onClick={() => act(t.ref, () => api.status(t.ref, { status: t.priced_by === "PNS" ? "Pending PNS" : "Pending Sales", reason: "vendor cost received" }))}>
                Vendor cost received
              </Btn>
            )}
            <Btn kind="primary" className="ml-auto"
              disabled={busy === t.ref
                || !((link[t.ref] || "").trim() || (file[t.ref] || "").trim())}
              onClick={() => {
                const url = (link[t.ref] || "").trim();
                const label = (file[t.ref] || "").trim();
                if (url && !/^https?:\/\//i.test(url))
                  return notify("The link must start with http:// or https://");
                const num = (v) => (v === "" || v == null ? null : Number(v));
                act(t.ref, () => api.price(t.ref, {
                  // A bare link with no label still needs something to show in lists.
                  price_file: label || "Pricing spreadsheet",
                  price_url: url || null,
                  margin_pct: num(margin[t.ref]),
                  discount_pct: num(disc[t.ref]),
                  below_bottom: !!below[t.ref],
                }));
              }}>
              Attach price
            </Btn>
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <OwnerBar t={t} me={me} notify={notify} onDone={reload} />
          </div>
            </>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- watched groups */
// One screen per watched group, reached from the sidebar submenu. Everything still
// pending, narrowed to Hypercare, Strategic or Must Win, because these are the deals
// somebody is asked about by name in a meeting and hunting for them across nine status
// queues is the wrong way round.
//
// The three are NOT the same kind of thing and the screen says so: Hypercare and
// Strategic are the ACCOUNT's tier, inherited from the Sales CRM account group, so they
// cover every deal that account brings; Must Win is ONE opportunity.
export function Watched({ me, onOpen, notify, group }) {
  const meta = WATCHED_GROUPS.find((g) => g.id === group) || WATCHED_GROUPS[0];
  const [rows, err, reload] = useTickets(
    { status: [...PENDING, "Proposal Submitted"], ...groupFilter(meta.id) }, [group]);
  const [list, f, set, clear, patch] = useFilter(rows);

  return (
    <Shell
      title={meta.label}
      sub={meta.level === "account"
        ? `An account tier, inherited from the Sales CRM account group — it covers every deal this shipper brings. Once priced, ${meta.label} goes to the Head of PNS first, then C-level. (The Head of Sales gate was retired on 14 August — they approve in Sales CRM.)`
        : "A tag on ONE opportunity, not on the account: the same shipper can have a Must Win deal and five ordinary ones. Sales CRM carries it as Lead Source Detail “Must Win”. It reaches C-level like the other two — Baskoro, 2026-08-13."}
      right={<Pill tone={meta.tone}>{(rows || []).length} live</Pill>}
      rows={rows} err={err}
      empty={`Nothing live in ${meta.label} right now.`}
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me} groups={false}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          // TicketCard already shows a Must Win pill of its own, so only the account
          // tiers need a badge here — otherwise every Must Win row said it twice.
          badges={t.group && t.group !== "Must Win"
            ? [<Pill key="g" tone={groupTone(t.group)}>{t.group}</Pill>] : []}>
          <OwnerBar t={t} me={me} notify={notify} onDone={reload} />
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- pending CRM id */
// Tickets raised here with no Sales CRM opportunity behind them. They cannot move until
// somebody supplies the id, so the screen does exactly one thing: collect it.
export function PendingCrmId({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Pending CRM ID" });
  const [ids, setIds] = useState({});
  const [busy, setBusy] = useState(null);

  const link = async (ref) => {
    const v = (ids[ref] || "").trim();
    if (!v) return notify("Paste the Sales CRM opportunity id first");
    setBusy(ref);
    try {
      await api.setCrmId(ref, v);
      notify(`${ref} linked to ${v} — now Open`);
      await reload();
    } catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  return (
    <Shell title="Pending CRM ID"
      sub="Raised here without a Sales CRM opportunity id. Sales CRM is the system of record and the sync finds each deal by its id, so these cannot move until the number is supplied — a ticket the sync cannot see would drift out of step and be believed anyway."
      rows={rows} err={err}
      empty="Nothing blocked. Every ticket is tied to a Sales CRM opportunity.">
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          {me.permissions.editInput ? (
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputCls} max-w-[280px] font-mono`}
                placeholder="Sales CRM opportunity id"
                value={ids[t.ref] || ""}
                onChange={(e) => setIds({ ...ids, [t.ref]: e.target.value })} />
              <Btn kind="primary" disabled={busy === t.ref} onClick={() => link(t.ref)}>
                Link and open
              </Btn>
              <span className="text-[11.5px] text-slate-400">
                Raised by {t.sales || "unknown"}
              </span>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              Sales adds the Sales CRM id.
            </p>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- open */
// Everything Sales has finished and nobody has started. This is the shelf, not a queue
// anyone is working: the point of the screen is that these tickets are ready and
// unclaimed, so the two actions are "I am taking this" and "this is not complete after
// all, back to Sales".
export function Open({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Open" });
  const [why, setWhy] = useState({});
  // Priced by, same control Awaiting price carries. This is the answer to "is Open mine
  // or Sales'?" (Michael, 2026-08-18): it is both, and the filter is how each side reads
  // its own half without the other side's tickets being hidden from anybody.
  const [list, f, set, clear, patch] = useFilter(rows, { resp: [] });
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const mayTake = ["PNS", "Commercial", "Admin"].includes(me.group);

  return (
    <Shell title="Open"
      sub="Intake is complete and nothing is owed by Sales — these are ready to be picked up, and nobody has yet. Taking one moves it to whoever owes the price. If something is actually missing, ask Sales and it goes back to them."
      rows={rows} err={err}
      empty="Nothing sitting unclaimed. Every ready ticket has somebody on it."
      bar={
        <FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
          shown={list.length} total={(rows || []).length} rows={rows}>
          <MultiSelect label="Priced by" picked={f.resp}
            onClear={() => patch("resp", [])}
            sections={pickList(["PNS", "Sales"], f.resp, (v) => patch("resp", v))} />
        </FilterBar>
      }
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[
            <Pill key="by" tone={t.priced_by === "PNS" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}>
              {t.priced_by} will price it
            </Pill>,
          ]}>
          {!t.revenue ? (
            <p className="text-[12.5px] text-rose-700">
              <b>No potential revenue.</b> It decides who prices this and which ceiling
              applies, so the ticket cannot start until it is filled in. Open the ticket
              and set it on the Input tab.
            </p>
          ) : mayTake ? (
            <>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputCls} max-w-[320px]`}
                placeholder="What is missing? (sends it back to Sales)"
                value={why[t.ref] || ""}
                onChange={(e) => setWhy({ ...why, [t.ref]: e.target.value })} />
              <Btn disabled={!((why[t.ref] || "").trim())}
                onClick={() => act(() => api.status(t.ref, {
                  status: "Pending Sales", reason: why[t.ref] }))}>
                Need info from Sales
              </Btn>
              <Btn kind="primary" className="ml-auto"
                onClick={() => act(() => api.status(t.ref, {
                  status: t.priced_by === "PNS" ? "Pending PNS" : "Pending Sales",
                  reason: `picked up by ${me.name}` }))}>
                Start work on this
              </Btn>
            </div>
            {/* Picking a ticket up and owning it are two different acts, and Open is
                where both happen. Starting work moves the status; taking it puts your
                name on it — this queue used to offer only the first, so an unclaimed
                ticket stayed unclaimed even after somebody started it. */}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <OwnerBar t={t} me={me} notify={notify} onDone={reload} />
            </div>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              Waiting for {t.priced_by} to pick it up.
            </p>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- PNS review */
export function ToReview({ me, onOpen, notify }) {
  // Both PNS gates in one list (Michael, 2026-08-18). They were two menu entries and it
  // made the sidebar ask a question the reader could not answer from outside: which of my
  // two review queues is this ticket in? One entry, and each card carries its own gate.
  // The ROUTING stays split — two statuses, two endpoints, two different decisions — only
  // the way in is shared.
  const [rows, err, reload] = useTickets(
    { status: "Pending Review - PNS,Pending Review - Head PNS" });
  const [why, setWhy] = useState({});
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  // Watched deals first: they are the ones with executives waiting behind them, and the
  // Head is the only gate that blocks a C-level sign-off.
  const ordered = [...list].sort((a, b) =>
    (a.status === "Pending Review - Head PNS" ? 0 : 1)
    - (b.status === "Pending Review - Head PNS" ? 0 : 1));

  return (
    <Shell title="Review - PNS"
      sub="Both PNS reviews. A watched deal (Hypercare, Strategic, Must Win) needs the Head to finalise the whole solution, and that is the FIRST gate — PSP and C-level come after, so nobody signs something unfinished. A Standard deal Sales priced at Rp 30 Mio or above needs a member to check the number, and clearing it sends the proposal out."
      rows={rows} err={err} empty="Nothing waiting on a PNS review."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={ordered}>
      {(list) => list.map((t) => {
        const head = t.status === "Pending Review - Head PNS";
        return (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[
            head
              ? <Pill key="g" tone="bg-amber-50 text-amber-700">Head finalises the solution</Pill>
              : <Pill key="g" tone="bg-violet-50 text-violet-700">Sales priced it — check the number</Pill>,
          ]}>
          {(t.price_file || t.price_url) && <p className="mb-2 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {!head && t.margin != null && (
            <p className="mb-3 text-[13px]">Margin submitted: <b className="font-mono">{t.margin}%</b></p>
          )}
          <RateCard service={t.service} />
          <div className="flex flex-wrap items-center gap-2">
            {/* The separate reviewer slot is retired (Baskoro, 2026-08-14) — one PNS
                assignment, not two. The bar that replaces it is the same one every
                other queue carries, so the ticket can be taken or handed over here
                without opening it. */}
            <OwnerBar t={t} me={me} notify={notify} onDone={reload} />
          </div>
          {me.permissions.markReviewed && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {/* Sending it back is the member's review saying "this is not right". The
                  Head's gate has no equivalent: they own the solution, so they fix it
                  rather than bounce it, and the generic send-back on the ticket is
                  still there if they want it. */}
              {!head && (
                <>
                  <input className={`${inputCls} max-w-[300px]`}
                    placeholder="What is wrong with it? (sends it back to Sales)"
                    value={why[t.ref] || ""}
                    onChange={(e) => setWhy({ ...why, [t.ref]: e.target.value })} />
                  <Btn disabled={!((why[t.ref] || "").trim())}
                    onClick={() => act(() => api.status(t.ref, {
                      status: "Pending Sales", reason: why[t.ref] }))}>
                    Send back to Sales
                  </Btn>
                </>
              )}
              {/* Same escalation from either gate, same rule: PSP is for when there is no
                  rate to price against. Gated on mayGoToPsp, so a Standard deal needs the
                  Head to have opened it on Alex's exception first. */}
              {me.permissions.sendToPsp && mayGoToPsp(t) && (
                <Btn onClick={() => act(() => api.status(t.ref, {
                  status: "Pending Review - PSP",
                  reason: head ? "sent for margin approval" : "no rate to price against" }))}>
                  {head ? "Send to PSP" : "Escalate to PSP"}
                </Btn>
              )}
              {/* Two endpoints, deliberately. /pns-final continues the watched chain and
                  the server decides whether PSP or C-level is next — hard-coding
                  "Proposal Submitted" here used to skip the executive sign-off on
                  Hypercare deals entirely. /pns-review is the member's yes and normally
                  ends at the proposal. */}
              <Btn kind="primary" className="ml-auto"
                onClick={() => act(async () => {
                  const r = head ? await api.pnsFinal(t.ref) : await api.pnsReview(t.ref);
                  notify(`${t.ref} ${head ? "finalised" : "checked"} → ${r.status}`);
                })}>
                {head ? "Finalise solution & pricing" : "Price is sound"}
              </Btn>
            </div>
          )}
        </TicketCard>
        );
      })}
    </Shell>
  );
}

/* The "Review - Head Sales" screen lived here. Retired 2026-08-14: the Head of Sales
   accepts a below-floor concession in Sales CRM, where they already work, so this app no
   longer holds a queue for them. A gate nobody opens is worse than no gate — the ticket
   just waits. Zero tickets held that status when it went, so nothing was stranded. */

/* ---------------------------------------------------------------- PSP */
export function PspPending({ me, onOpen, notify }) {
  // One screen, two views. "Decided" was a second menu entry, which made PSP's history
  // look like another queue waiting on somebody. It is the same list of tickets seen
  // before and after the decision, so it belongs behind a toggle, not a separate page.
  const [view, setView] = useState("pending");
  const [rows, err, reload] = useTickets(
    view === "pending" ? { status: "Pending Review - PSP" } : { psp_reviewed: true },
    [view]);
  const [note, setNote] = useState({});
  const [link, setLink] = useState({});
  const [file, setFile] = useState({});
  const [margin, setMargin] = useState({});
  const [disc, setDisc] = useState({});
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  // A ticket reaches PSP because someone else could not price it, or PSP is checking a
  // figure someone else already entered — either way, the PIC's own calculation should
  // be enterable in the same step as deciding, not a separate trip through Awaiting
  // price first. Blank fields mean "deciding on what's already attached."
  const pricePayload = (ref) => {
    const url = (link[ref] || "").trim();
    if (url && !/^https?:\/\//i.test(url)) {
      notify("The link must start with http:// or https://");
      return null;
    }
    const num = (v) => (v === "" || v == null ? null : Number(v));
    const out = {};
    if (url) { out.price_url = url; out.price_file = (file[ref] || "").trim() || "Pricing spreadsheet"; }
    if (margin[ref] !== undefined && margin[ref] !== "") out.margin_pct = num(margin[ref]);
    if (disc[ref] !== undefined && disc[ref] !== "") out.discount_pct = num(disc[ref]);
    return out;
  };

  return (
    <Shell title="Review - PSP"
      sub={view === "pending"
        ? "One shared queue, nobody assigned. PSP reviews the margin and approves or rejects; any PSP member may decide any ticket. A below-floor price lands here FIRST — PSP settles whether the margin is survivable, then the Sales Head decides whether Sales will wear the concession."
        : "Everything PSP has already ruled on, and where each ticket stands now. History, not a queue — nothing here is waiting on anybody."}
      right={
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 p-0.5">
          {[["pending", "Waiting on PSP"], ["decided", "Already decided"]].map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${
                view === v ? "bg-[#EE1B2C] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
        </div>
      }
      rows={rows} err={err}
      empty={view === "pending" ? "Nothing awaiting price approval."
                                : "PSP hasn't decided on anything yet."}
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
>
          {(t.price_file || t.price_url) && <p className="mb-2 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {t.margin != null && (
            <p className="mb-3 text-[13px]">Margin: <b className="font-mono">{t.margin}%</b></p>
          )}
          {view === "decided" ? (
            <div className="flex flex-wrap items-center gap-2">
              {t.psp_decision && (
                <Pill tone={t.psp_decision === "approved"
                  ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}>
                  PSP {t.psp_decision}
                </Pill>
              )}
              <span className="text-[12.5px] text-slate-500">Now: {t.status}</span>
            </div>
          ) : me.permissions.pspDecide || me.permissions.pspOverride ? (
            <>
              {!me.permissions.pspDecide && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  You are deciding in PSP&apos;s place. A note is required and the approval
                  is recorded as an override, not as a PSP decision.
                </p>
              )}
              <div className="mb-2 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <input className={inputCls} type="url" inputMode="url"
                  placeholder="Link to your pricing — https://docs.google.com/spreadsheets/…"
                  value={link[t.ref] ?? ""} onChange={(e) => setLink({ ...link, [t.ref]: e.target.value })} />
                <input className={inputCls} placeholder="Label (optional)"
                  value={file[t.ref] ?? ""} onChange={(e) => setFile({ ...file, [t.ref]: e.target.value })} />
              </div>
              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input className={inputCls} type="number" step="0.1" min="0" max="100"
                  placeholder="Margin % (leave blank to keep as-is)"
                  value={margin[t.ref] ?? ""} onChange={(e) => setMargin({ ...margin, [t.ref]: e.target.value })} />
                <input className={inputCls} type="number" step="0.1" min="0" max="100"
                  placeholder="Discount % (leave blank to keep as-is)"
                  value={disc[t.ref] ?? ""} onChange={(e) => setDisc({ ...disc, [t.ref]: e.target.value })} />
              </div>
              <p className="mb-3 text-[11px] text-slate-400">
                Only fill these in if you're entering or correcting the figure yourself —
                blank leaves whatever is already attached untouched.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputCls} max-w-[320px]`}
                  placeholder={me.permissions.pspDecide
                    ? "Note (required to reject)"
                    : "Why PSP could not decide (required)"}
                  value={note[t.ref] || ""} onChange={(e) => setNote({ ...note, [t.ref]: e.target.value })} />
                <Btn kind="danger" onClick={() => {
                  const p = pricePayload(t.ref);
                  if (!p) return;
                  act(() => api.psp(t.ref, { ...p, approve: false, note: note[t.ref] }));
                }}>
                  Reject
                </Btn>
                <Btn kind="primary" className="ml-auto" onClick={() => {
                  const p = pricePayload(t.ref);
                  if (!p) return;
                  act(() => api.psp(t.ref, { ...p, approve: true, note: note[t.ref] }));
                }}>
                  {me.permissions.pspDecide ? "Approve price" : "Approve on behalf of PSP"}
                </Btn>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-500">Only PSP can approve or reject here.</p>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- exec sign-off */
// The last gate. Alex and Dhinesh sign off over email; this screen records that it
// happened and releases the proposal. The draft button exists because writing that
// email by hand, per ticket, is the job this app is meant to remove.
export function ExecSignoff({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Pending Review - C-level" });
  const [note, setNote] = useState({});
  const [draft, setDraft] = useState({});
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const showDraft = async (ref) => {
    try {
      const d = await api.signoffDraft(ref);
      setDraft({ ...draft, [ref]: d.body });
    } catch (e) { notify(e.message); }
  };

  return (
    <Shell title="Review - C-level"
      sub="Hypercare and Strategic solutions need Alex (CSO) and Dhinesh (COO). Every other approval has already cleared; this is the last gate before the proposal goes out."
      rows={rows} err={err} empty="Nothing awaiting executive sign-off."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone="bg-fuchsia-50 text-fuchsia-700">{t.acct_type}</Pill>
            {(t.price_file || t.price_url) && <PriceChip file={t.price_file} url={t.price_url} />}
          </div>
          {draft[t.ref] && (
            <textarea readOnly rows={12}
              className="mb-3 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[12px]"
              value={draft[t.ref]}
              onFocus={(e) => e.target.select()} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={() => showDraft(t.ref)}>
              {draft[t.ref] ? "Refresh draft" : "Draft the email"}
            </Btn>
            <input className={`${inputCls} max-w-[300px]`} placeholder="Note (optional)"
              value={note[t.ref] || ""} onChange={(e) => setNote({ ...note, [t.ref]: e.target.value })} />
            {me.permissions.markReviewed && (
              <Btn kind="primary" className="ml-auto"
                onClick={() => act(() => api.execSignoff(t.ref, { done: true, note: note[t.ref] }))}>
                Record sign-off
              </Btn>
            )}
          </div>
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- proposals */
export function Proposals({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Proposal Submitted" });
  const [next, setNext] = useState({});
  const [reason, setReason] = useState({});
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const mayClose = me.permissions.acceptProposal;
  const mayPull = me.permissions.sendBackProposal;

  return (
    <Shell title="Proposal submitted"
      sub="Proposals sitting with the shipper. Accepted and lost deals move out of this list."
      rows={rows} err={err} empty="No proposals submitted yet."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          {(t.price_file || t.price_url) && <p className="mb-3 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {(mayPull || mayClose) && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} max-w-[220px]`} value={next[t.ref] || PENDING[0]}
                onChange={(e) => setNext({ ...next, [t.ref]: e.target.value })}>
                <optgroup label="Send back">
                  {PENDING.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                {mayClose && (
                  <optgroup label="Lost">
                    {PICKABLE_LOSS_REASONS.map(([v, l]) => <option key={v} value={`Lost:${v}`}>{l}</option>)}
                  </optgroup>
                )}
              </select>
              <input className={`${inputCls} max-w-[300px]`} placeholder="Reason — required to send back"
                value={reason[t.ref] || ""} onChange={(e) => setReason({ ...reason, [t.ref]: e.target.value })} />
              <Btn onClick={() => {
                const sel = next[t.ref] || PENDING[0];
                const body = sel.startsWith("Lost:")
                  ? { status: "Lost", loss_reason: sel.slice(5) }
                  : { status: sel, reason: reason[t.ref] };
                act(() => api.status(t.ref, body));
              }}>
                Change status
              </Btn>
              {mayClose ? (
                <Btn kind="primary" className="ml-auto"
                  onClick={() => act(() => api.status(t.ref, { status: "Proposal Accepted / Ready to Ship" }))}>
                  Proposal accepted
                </Btn>
              ) : (
                <span className="ml-auto text-[12px] text-slate-500">Sales records the outcome</span>
              )}
            </div>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- ready to ship */
export function ReadyToShip({ me, onOpen }) {
  const [rows, err] = useTickets({ status: "Proposal Accepted / Ready to Ship" });
  const [list, f, set, clear, patch] = useFilter(rows);
  return (
    <Shell title="Ready to ship"
      sub="Accepted proposals, handed to Legal for the contract and then to Ops."
      rows={rows} err={err} empty="Nothing ready to ship yet."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} rows={rows} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          {(t.price_file || t.price_url) && <p className="text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- recycle bin */
export function RecycleBin({ me, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [ask, setAsk] = useState(null);
  const reload = () => api.deleted().then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, []);

  const act = async (fn, msg) => {
    try { await fn(); notify(msg); await reload(); }
    catch (e) { notify(e.message); }
  };

  return (
    <>
      <Shell title="Recycle bin"
        sub="Deleted tickets, kept with their history. Restore one to put it back where it was, or delete it for good."
        right={<span className="text-[12px] text-slate-500">PNS Head &amp; Admin</span>}
        rows={rows} err={err} empty="The bin is empty.">
        {(list) => list.map((t) => (
          <TicketCard key={t.ref} t={t} onOpen={onOpen}>
            <div className="flex flex-wrap items-center gap-2">
              <Btn kind="primary" onClick={() => act(() => api.restore(t.ref), `${t.ref} restored`)}>
                Restore
              </Btn>
              {me?.permissions.purgeTicket && (
                <Btn kind="danger" className="ml-auto" onClick={() => setAsk({
                  ref: t.ref,
                  title: `Delete ${t.ref} for good?`,
                  body: `This erases ${t.shipper}, its history, its intake and its attached price permanently. It cannot be undone.`,
                })}>
                  Delete permanently
                </Btn>
              )}
            </div>
          </TicketCard>
        ))}
      </Shell>

      <Confirm open={!!ask} title={ask?.title} body={ask?.body} confirmLabel="Delete for good"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const ref = ask.ref; setAsk(null);
          act(() => api.purge(ref), `${ref} permanently deleted`);
        }} />
    </>
  );
}

// The meeting screens moved to Meetings.jsx on 2026-08-14, where the Review meeting
// gained region and salesperson multi-select and the Weekly meeting was added beside it.
