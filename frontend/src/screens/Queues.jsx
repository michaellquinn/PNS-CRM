import { useEffect, useState } from "react";
import { api, PENDING, LOSS_REASONS, SERVICES, FTL, rp } from "../api";
import {
  Btn, Card, Confirm, Empty, Head, Pill, PriceChip, TicketCard, inputCls, usePnsTeam,
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
// a couple of dropdowns beat sending every keystroke back to the server.
function useFilter(rows, extra = {}) {
  const [f, setF] = useState({ q: "", service: "", ...extra });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const clear = () => setF({ q: "", service: "", ...extra });
  const out = (rows || []).filter((t) => {
    const q = f.q.trim().toLowerCase();
    if (q && !`${t.ref} ${t.shipper}`.toLowerCase().includes(q)) return false;
    if (f.service && t.service !== f.service) return false;
    if (f.resp && t.priced_by !== f.resp) return false;
    if (f.owner && (t.owner || "") !== (f.owner === "__none__" ? "" : f.owner)) return false;
    return true;
  });
  return [out, f, set, clear];
}

function FilterBar({ f, set, clear, shown, total, children }) {
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2.5 p-3">
      <input type="search" value={f.q} onChange={set("q")} placeholder="Search shipper or ID…"
        className="min-w-[190px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]" />
      <select className={`${inputCls} max-w-[150px]`} value={f.service} onChange={set("service")}>
        <option value="">Any service</option>
        {SERVICES.map((s) => <option key={s}>{s}</option>)}
      </select>
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

function RateCard({ service }) {
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px]">
      <span className="opacity-60">🔗</span>
      <div>
        <b className="underline decoration-slate-300 underline-offset-2">Rate card — {service}</b>
        <p className="text-[11.5px] text-slate-500">Build the price from the published card.</p>
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
  const [list, f, set, clear] = useFilter(rows, { resp: "" });

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
        <FilterBar f={f} set={set} clear={clear} shown={list.length} total={(rows || []).length}>
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
          ].filter(Boolean)}
        >
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
            Share the sheet with whoever needs it in Drive first — this app stores the link,
            it cannot grant access. Keep cost and margin workings out of any sheet a
            shipper or Commercial will open.
          </p>
          {/* The tier ceiling is checked against these. Leaving one blank is not a breach —
              a standard rate card has nothing to declare — but then nothing is checked either. */}
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[12.5px] font-medium text-amber-800">
              <input type="checkbox" checked={!!below[t.ref]}
                onChange={(e) => setBelow({ ...below, [t.ref]: e.target.checked })} />
              Below bottom rate
            </label>
            {/* Vendor cost is an FTL-only detour — nothing else is priced through a vendor. */}
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
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- PNS review */
export function ToReview({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Pending PNS Review" });
  const [who, setWho] = useState({});
  const team = usePnsTeam();
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  return (
    <Shell title="To review"
      sub="Non-Strategic at or above 30 Mio — Sales priced it, PNS reviews before it goes out."
      rows={rows} err={err} empty="Nothing waiting on review.">
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
            {me.permissions.sendToPsp && (
              <Btn onClick={() => act(() => api.status(t.ref, { status: "Pending PSP Approval", reason: "sent for margin approval" }))}>
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
  const [rows, err, reload] = useTickets({ status: "Pending Head Review" });
  const [note, setNote] = useState({});
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  return (
    <Shell title="Need review"
      sub="Prices flagged below the bottom rate. The head of the team that priced it acknowledges before it goes out."
      right={<span className="text-[12px] text-slate-500">Head only</span>}
      rows={rows} err={err} empty="Nothing needs your review.">
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}
          badges={[<Pill key="b" tone="bg-amber-50 text-amber-700">Below bottom rate</Pill>]}>
          {(t.price_file || t.price_url) && <p className="mb-2 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {t.margin != null && (
            <p className="mb-3 text-[13px]">Margin submitted: <b className="font-mono">{t.margin}%</b></p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} max-w-[320px]`} placeholder="Note (required to send back)"
              value={note[t.ref] || ""} onChange={(e) => setNote({ ...note, [t.ref]: e.target.value })} />
            <Btn onClick={() => act(() => api.status(t.ref, { status: "Pending Sales", reason: note[t.ref] }))}>
              Send back to Sales
            </Btn>
            <Btn kind="primary" className="ml-auto" onClick={() => act(() => api.headAck(t.ref))}>
              Acknowledge
            </Btn>
          </div>
        </TicketCard>
      ))}
    </Shell>
  );
}

/* ---------------------------------------------------------------- PSP */
export function PspApprovals({ me, onOpen, notify }) {
  const [rows, err, reload] = useTickets({ status: "Pending PSP Approval" });
  const [note, setNote] = useState({});
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  return (
    <Shell title="Price approvals"
      sub="PSP reviews the margin and approves or rejects. PNS and Sales send prices here."
      rows={rows} err={err} empty="Nothing awaiting price approval.">
      {(list) => list.map((t) => (
        <TicketCard key={t.ref} t={t} onOpen={onOpen}>
          {(t.price_file || t.price_url) && <p className="mb-2 text-[13px]"><PriceChip file={t.price_file} url={t.price_url} /></p>}
          {t.margin != null && (
            <p className="mb-3 text-[13px]">Margin: <b className="font-mono">{t.margin}%</b></p>
          )}
          {me.permissions.pspDecide || me.permissions.pspOverride ? (
            <>
              {!me.permissions.pspDecide && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  You are deciding in PSP&apos;s place. A note is required and the approval
                  is recorded as an override, not as a PSP decision.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputCls} max-w-[320px]`}
                  placeholder={me.permissions.pspDecide
                    ? "Note (required to reject)"
                    : "Why PSP could not decide (required)"}
                  value={note[t.ref] || ""} onChange={(e) => setNote({ ...note, [t.ref]: e.target.value })} />
                <Btn kind="danger" onClick={() => act(() => api.psp(t.ref, { approve: false, note: note[t.ref] }))}>
                  Reject
                </Btn>
                <Btn kind="primary" className="ml-auto"
                  onClick={() => act(() => api.psp(t.ref, { approve: true, note: note[t.ref] }))}>
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
  const [rows, err, reload] = useTickets({ status: "Pending Exec Sign-off" });
  const [note, setNote] = useState({});
  const [draft, setDraft] = useState({});
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const showDraft = async (ref) => {
    try {
      const d = await api.signoffDraft(ref);
      setDraft({ ...draft, [ref]: d.body });
    } catch (e) { notify(e.message); }
  };

  return (
    <Shell title="Executive sign-off"
      sub="Hypercare and Strategic solutions need Alex (CSalesO) and Dhinesh (COO). Every other approval has already cleared — this is the last gate before the proposal goes out."
      rows={rows} err={err} empty="Nothing awaiting executive sign-off.">
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
  const [list, f, set, clear] = useFilter(rows, { owner: "" });
  const team = usePnsTeam();
  const act = async (fn) => { try { await fn(); notify("Done"); await reload(); } catch (e) { notify(e.message); } };

  const mayClose = me.permissions.acceptProposal;
  const mayPull = me.permissions.sendBackProposal;

  return (
    <Shell title="Proposal submitted"
      sub="Proposals sitting with the shipper. Accepted and lost deals move out of this list."
      rows={rows} err={err} empty="No proposals submitted yet."
      bar={
        <FilterBar f={f} set={set} clear={clear} shown={list.length} total={(rows || []).length}>
          <select className={`${inputCls} max-w-[160px]`} value={f.owner} onChange={set("owner")}>
            <option value="">Any PNS owner</option>
            <option value="__none__">Unassigned</option>
            {team.map((n) => <option key={n}>{n}</option>)}
          </select>
        </FilterBar>
      }
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
                    {LOSS_REASONS.map(([v, l]) => <option key={v} value={`Lost:${v}`}>{l}</option>)}
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
export function ReadyToShip({ onOpen }) {
  const [rows, err] = useTickets({ status: "Proposal Accepted / Ready to Ship" });
  return (
    <Shell title="Ready to ship"
      sub="Accepted proposals — handed to Legal for the contract, then to Ops."
      rows={rows} err={err} empty="Nothing ready to ship yet.">
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
        right={<span className="text-[12px] text-slate-500">PNS Admin only</span>}
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
        <Block label="A · Proposals submitted" sub="Start here — each salesperson walks their own."
          list={props} tone="bg-teal-50 text-teal-700" />
        <Block label="B · All pending" sub="Everything still open, by salesperson."
          list={pend} tone="bg-amber-50 text-amber-700" />
      </div>
    </>
  );
}
