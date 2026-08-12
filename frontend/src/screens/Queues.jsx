import { useEffect, useState } from "react";
import { api, BOTTOM_MARGIN, PENDING, PICKABLE_LOSS_REASONS, SERVICES, FTL,
         mayGoToPsp, rp } from "../api";
import {
  Btn, Card, Confirm, Empty, Head, Pill, PriceChip, TicketCard, inputCls,
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
function useFilter(rows, extra = {}) {
  const base = { q: "", service: "", owner: "", ...extra };
  const [f, setF] = useState(base);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const patch = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const clear = () => setF(base);
  const out = (rows || []).filter((t) => {
    const q = f.q.trim().toLowerCase();
    if (q && !`${t.ref} ${t.shipper}`.toLowerCase().includes(q)) return false;
    if (f.service && t.service !== f.service) return false;
    if (f.resp && t.priced_by !== f.resp) return false;
    if (f.owner && (t.owner || "") !== (f.owner === "__none__" ? "" : f.owner)) return false;
    return true;
  });
  return [out, f, set, clear, patch];
}

function FilterBar({ f, set, clear, patch, me, shown, total, children }) {
  const team = usePnsTeam();
  const mineOn = me && f.owner === me.name;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-3">
      <input type="search" value={f.q} onChange={set("q")} placeholder="Search shipper or ID…"
        className="min-w-[190px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]" />
      <select className={`${inputCls} max-w-[150px]`} value={f.service} onChange={set("service")}>
        <option value="">Any service</option>
        {SERVICES.map((s) => <option key={s}>{s}</option>)}
      </select>
      <select className={`${inputCls} max-w-[160px]`} value={f.owner} onChange={set("owner")}>
        <option value="">Any PNS PIC</option>
        <option value="__none__">Unassigned</option>
        {team.map((n) => <option key={n}>{n}</option>)}
      </select>
      {me && team.includes(me.name) && patch && (
        <button type="button" aria-pressed={mineOn}
          onClick={() => patch("owner", mineOn ? "" : me.name)}
          className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
            mineOn ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
                   : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
          Assigned to me
        </button>
      )}
      {children}
      <span className="text-[12px] text-slate-500">{shown} of {total}</span>
      <Btn onClick={clear}>Clear</Btn>
    </Card>
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
  const [list, f, set, clear, patch] = useFilter(rows, { resp: "" });

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
          shown={list.length} total={(rows || []).length}>
          <select className={`${inputCls} max-w-[150px]`} value={f.resp} onChange={set("resp")}>
            <option value="">Priced by anyone</option>
            <option value="PNS">Priced by PNS</option>
            <option value="Sales">Priced by Sales</option>
          </select>
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
            </>
          )}
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
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const mayTake = ["PNS", "Commercial", "Admin"].includes(me.group);

  return (
    <Shell title="Open"
      sub="Intake is complete and nothing is owed by Sales — these are ready to be picked up, and nobody has yet. Taking one moves it to whoever owes the price. If something is actually missing, ask Sales and it goes back to them."
      rows={rows} err={err}
      empty="Nothing sitting unclaimed. Every ready ticket has somebody on it."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[
            <Pill key="by" tone={t.priced_by === "PNS" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700"}>
              {t.priced_by} will price it
            </Pill>,
          ]}>
          {mayTake ? (
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
  const [rows, err, reload] = useTickets({ status: "Pending Review - Head PNS" });
  const [who, setWho] = useState({});
  const team = usePnsTeam();
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  return (
    <Shell title="Review - Head PNS"
      sub="Hypercare, Strategic and Must Win only: Sales priced it, PNS checks before it reaches the shipper. Standard deals now go straight out, whatever the revenue."
      rows={rows} err={err} empty="Nothing waiting on review."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          {(t.price_file || t.price_url) && <p className="mb-3 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          <RateCard service={t.service} />
          <div className="flex flex-wrap items-center gap-2">
            {t.reviewer ? (
              <Pill tone="bg-violet-50 text-violet-700">Reviewer: {t.reviewer}</Pill>
            ) : me.permissions.assignReviewer ? (
              team.length === 0 ? (
                <span className="text-[12.5px] text-slate-500">
                  No active PNS members are registered yet — add them under Administration.
                </span>
              ) : (
                <>
                  <select className={`${inputCls} max-w-[180px]`} value={who[t.ref] || team[0]}
                    onChange={(e) => setWho({ ...who, [t.ref]: e.target.value })}>
                    {team.map((n) => <option key={n}>{n}</option>)}
                  </select>
                  <Btn kind="primary" onClick={() => act(() => api.assign(t.ref, who[t.ref] || team[0]))}>
                    Assign reviewer
                  </Btn>
                </>
              )
            ) : (
              <span className="text-[12.5px] text-slate-500">Waiting for the PNS Head to assign a reviewer.</span>
            )}
            {me.permissions.sendToPsp && mayGoToPsp(t) && (
              <Btn onClick={() => act(() => api.status(t.ref, { status: "Pending Review - PSP", reason: "sent for margin approval" }))}>
                Send to PSP
              </Btn>
            )}
            {me.permissions.markReviewed && (
              <Btn kind="primary" className="ml-auto"
                onClick={() => act(() => api.status(t.ref, { status: "Proposal Submitted", reason: "reviewed and approved" }))}>
                Approve &amp; submit proposal
              </Btn>
            )}
          </div>
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- head review */
export function HeadReview({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Pending Review - Head Sales" });
  const [note, setNote] = useState({});
  const [list, f, set, clear, patch] = useFilter(rows);
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  // Everyone may watch this queue; only the Sales Head (or Admin) holds the pen.
  const mayAck = me.permissions.headAck;

  return (
    <Shell title="Review - Head Sales"
      sub="Prices below the tier floor, checked automatically or flagged by hand. The Sales Head acknowledges, then PSP signs off on the margin before it goes out."
      right={<span className="text-[12px] text-slate-500">
        {mayAck ? "You can acknowledge" : "View only — the Sales Head decides"}
      </span>}
      rows={rows} err={err} empty="Nothing needs the Sales Head."
      bar={<FilterBar f={f} set={set} clear={clear} patch={patch} me={me}
        shown={list.length} total={(rows || []).length} />}
      filtered={list}>
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[<Pill key="b" tone="bg-amber-50 text-amber-700">Below bottom rate</Pill>]}>
          {(t.price_file || t.price_url) && <p className="mb-2 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {t.margin != null && (
            <p className="mb-3 text-[13px]">Margin submitted: <b className="font-mono">{t.margin}%</b></p>
          )}
          {mayAck ? (
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputCls} max-w-[320px]`} placeholder="Note (required to send back)"
                value={note[t.ref] || ""} onChange={(e) => setNote({ ...note, [t.ref]: e.target.value })} />
              <Btn onClick={() => act(() => api.status(t.ref, {
                status: t.priced_by === "PNS" ? "Pending PNS" : "Pending Sales", reason: note[t.ref],
              }))}>
                Send back to {t.priced_by === "PNS" ? "PNS" : "Sales"}
              </Btn>
              <Btn kind="primary" className="ml-auto" onClick={() => act(() => api.headAck(t.ref))}>
                Acknowledge — send to PSP
              </Btn>
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">
              Waiting on the Sales Head to acknowledge or send back.
            </p>
          )}
        </TicketCard>
      ))}
    </Shell>
  );
}

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
        shown={list.length} total={(rows || []).length} />}
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
        shown={list.length} total={(rows || []).length} />}
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
        shown={list.length} total={(rows || []).length} />}
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
        shown={list.length} total={(rows || []).length} />}
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

/* ---------------------------------------------------------------- weekly meeting */
export function Meeting({ onOpen }) {
  const [props, setProps] = useState(null);
  const [pend, setPend] = useState(null);
  const [who, setWho] = useState("");

  useEffect(() => {
    api.tickets({ status: "Proposal Submitted" }).then((d) => setProps(d.tickets));
    api.tickets({ status: PENDING }).then((d) => setPend(d.tickets));
  }, []);

  const sales = [...new Set([...(props || []), ...(pend || [])].map((t) => t.sales).filter(Boolean))];
  let n = 0;

  const Block = ({ label, sub, list, tone }) => {
    const rows = (list || []).filter((t) => !who || t.sales === who);
    const byPerson = rows.reduce((acc, t) => {
      (acc[t.sales || "Unassigned"] ||= []).push(t);
      return acc;
    }, {});
    return (
      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-[13.5px] font-semibold">{label}</h3>
            <p className="text-[12px] text-slate-500">{sub}</p>
          </div>
          <Pill tone={tone}>{rows.length} to walk</Pill>
        </div>
        <div className="p-4">
          {rows.length === 0 && <p className="text-center text-sm text-slate-400">Nothing here this week.</p>}
          {Object.keys(byPerson).sort().map((person) => (
            <div key={person} className="mb-4 border-l-2 border-[#EE1B2C] pl-3.5 last:mb-0">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                {person} &middot; {byPerson[person].length}
              </div>
              {byPerson[person].map((t) => {
                n += 1;
                return (
                  <div key={t.ref} className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
                    <span className="w-7 font-mono text-[11px] text-slate-400">{n}.</span>
                    <button onClick={() => onOpen(t.ref)} className="font-mono text-[13px] font-bold text-[#EE1B2C] hover:underline">
                      {t.ref}
                    </button>
                    <b className="text-[13px]">{t.shipper}</b>
                    <Pill dot>{t.status}</Pill>
                    <span className="text-[12px] text-slate-500">{t.service} &middot; {rp(t.revenue)}</span>
                    <span className="ml-auto text-[12px] text-slate-400">
                      PNS: {t.owner || "unassigned"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
    );
  };

  return (
    <>
      <Head title="Weekly meeting"
        sub="Walk the list top to bottom. Proposals first, then everything pending — grouped by the salesperson who presents it."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} max-w-[200px]`} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">All salespeople</option>
              {sales.map((s) => <option key={s}>{s}</option>)}
            </select>
            <Btn onClick={() => window.print()}>Print agenda</Btn>
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <Block label="A · Proposals submitted" sub="Start here. Each salesperson walks their own."
          list={props} tone="bg-teal-50 text-teal-700" />
        <Block label="B · All pending" sub="Everything still open, by salesperson."
          list={pend} tone="bg-amber-50 text-amber-700" />
      </div>
    </>
  );
}
