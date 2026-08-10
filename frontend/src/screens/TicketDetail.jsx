import { useEffect, useState } from "react";
import { api, SERVICES, rp } from "../api";
import { charterHtml, charterText, copyRich } from "../charter";
import Discussion from "./Discussion";
import Attachments from "./Attachments";
import {
  Btn, Card, Combo, Confirm, Head, Pill, PriceChip, Sla, inputCls,
  useDirectory, useOptions, usePnsTeam, refreshOptions,
} from "../ui";

const SECTIONS = [
  ["1 · Shipper profile", [
    ["shipper", "Shipper name"], ["shipperStatus", "Status"], ["brief", "Brief summary"],
    ["shipperPic", "Shipper PIC"], ["shipperContact", "Contact shipper PIC"],
    ["invPic", "Invoicing PIC"], ["invContact", "Contact invoicing PIC"],
    ["invAddr", "Invoicing address"], ["pickPic", "Pickup PIC"], ["pickContact", "Contact pickup PIC"],
    ["pickup", "Pickup address"], ["dest", "Destination"], ["freq", "Shipment frequency"],
    ["volume", "Shipment volume"], ["pickSlot", "Pickup time"], ["pickWait", "Pickup waiting time"],
    ["delSlot", "Delivery time"], ["delWait", "Delivery waiting time"],
    ["sfid", "Salesforce Opportunity ID"], ["globalId", "Global ID"], ["jiraId", "Jira ID"],
  ]],
  ["2 · Cargo knowledge", [
    ["commodity", "Product"], ["product", "Specific product"],
    ["dim", "Dimension"], ["wt", "Weight (kg)"], ["pallet", "Palletized"],
  ]],
  ["3 · Ninja's service", [
    ["destType", "Delivery destination type"], ["sla", "SLA"], ["mps", "MPS"],
    ["rdo", "RDO"], ["cod", "COD"], ["tkbmO", "TKBM origin"], ["tkbmD", "TKBM destination"],
    ["ins", "Insurance"], ["truck", "Vehicle request"], ["golive", "Go live"],
    ["handling", "Custom handling request"], ["notes", "Notes"],
  ]],
];

const EDITABLE = SECTIONS.flatMap(([, fields]) => fields);
const LONG = ["brief", "handling", "notes", "invAddr", "pickup", "dest"];
const YESNO = ["mps", "rdo", "cod", "tkbmO", "tkbmD", "ins"];
const HOURS = ["pickWait", "delWait"];

// Waiting time is the one field where blank is an answer, not a gap: "None" means the
// driver does not wait, which is a costed fact. Everything else shows an em dash.
function display(k, v) {
  const s = String(v ?? "").trim();
  if (HOURS.includes(k)) return s === "" ? "None" : `${s} hour${Number(s) === 1 ? "" : "s"}`;
  return s;
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 last:border-0 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12.5px] text-slate-500">{label}</dt>
      <dd className="text-[13px]">{children}</dd>
    </div>
  );
}

// The prop is `ticketRef`, not `ref` — React reserves `ref` on components.
export default function TicketDetail({ ticketRef: initialRef, me, notify, onBack }) {
  const [ref, setRef] = useState(initialRef);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("charter");
  const [all, setAll] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);
  const [qCount, setQCount] = useState(null);
  const [fCount, setFCount] = useState(0);
  const [photos, setPhotos] = useState([]);
  const opts = useOptions();
  const team = usePnsTeam();
  const psp = useDirectory().filter((x) => x.group === "PSP").map((x) => x.name);

  const loadList = () => api.tickets({}).then((x) => setAll(x.tickets)).catch(() => {});
  useEffect(() => { loadList(); }, []);

  // Kept separate from load(): load() blanks the ticket while it refetches, which
  // unmounts the active tab. If the Attachments tab called load() back on every refresh
  // it would remount, refetch, and call back again — forever.
  const loadFiles = () =>
    api.files(ref)
      .then((x) => {
        setFCount(x.files.length);
        setPhotos(x.files.filter((f) => f.kind === "goods_photo" && f.is_image));
      })
      .catch(() => { setFCount(0); setPhotos([]); });

  const load = () => {
    setD(null); setErr(null); setDraft(null); setQCount(null);
    api.ticket(ref).then(setD).catch((e) => setErr(e.message));
    loadFiles();     // the charter shows cargo photos inline, without opening the tab
  };
  useEffect(() => { if (ref) load(); }, [ref]);

  const run = async (fn, msg) => {
    setBusy(true);
    try { await fn(); notify(msg); load(); loadList(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  if (!ref) return <Head title="Ticket detail" sub="Pick a ticket from any list to open it here." />;
  if (err) return (
    <>
      <Head title="Ticket detail" right={<Btn onClick={onBack}>Back</Btn>} />
      <Card className="border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>
    </>
  );
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;

  const t = d.ticket;
  const i = d.input || {};
  const p = me.permissions;
  const remembered = opts?.remembered || {};
  const closed = ["Lost", "Cancel"].includes(t.status);

  const startEdit = () => setDraft({
    ...Object.fromEntries(EDITABLE.map(([k]) => [k, i[k] ?? ""])),
    __service: t.service, __revenue: String(t.revenue), __acct: t.acct_type,
  });

  const saveEdit = () => {
    const payload = {};
    EDITABLE.forEach(([k]) => {
      if ((draft[k] ?? "") !== (i[k] ?? "")) payload[k] = draft[k];
    });
    const body = { payload };
    if (draft.__service !== t.service) body.service = draft.__service;
    if (p.editAcctOrRev) {
      const rev = parseInt(String(draft.__revenue).replace(/\D/g, ""), 10);
      if (!Number.isNaN(rev) && rev !== t.revenue) body.revenue = rev;
      if (draft.__acct !== t.acct_type) body.acct_type = draft.__acct;
    }
    if (!Object.keys(payload).length && !body.service && body.revenue == null && !body.acct_type) {
      setDraft(null);
      return notify("Nothing changed");
    }
    run(() => api.editInput(ref, body).then(refreshOptions), `${ref} updated`);
  };

  // The charter gets emailed to stakeholders, so it goes on the clipboard as a real
  // HTML table with inline styles — pasting into Gmail keeps the formatting.
  const copyCharter = async () => {
    const extras = [["Pricing", d.price_url || d.price_file || "not yet priced"]];
    if (photos.length) extras.push(["Photos of the goods", `${photos.length} attached in the app`]);
    try {
      const how = await copyRich(
        charterHtml(t, i, SECTIONS, display, extras),
        charterText(t, i, SECTIONS, display, extras));
      notify(how === "rich"
        ? "Charter copied — paste into your email and the table comes with it"
        : "Charter copied");
    } catch (e) { notify(e.message); }
  };

  const openQ = qCount ?? t.open_questions;
  const tabs = [["charter", "Project Charter"], ["input", "Input"], ["pricing", "Pricing"],
                ["files", "Attachments", fCount], ["discussion", "Discussion", openQ],
                ["history", "History"]];

  return (
    <>
      <Head
        title={t.shipper}
        sub={`${t.acct_type} · ${rp(t.revenue)} · ${t.region}${t.sales ? ` · sales ${t.sales}` : ""}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]"
              value={ref} onChange={(e) => setRef(e.target.value)}>
              {all.map((x) => <option key={x.ref} value={x.ref}>{x.ref} — {x.shipper}</option>)}
            </select>
            {p.deleteTicket && (
              <Btn kind="danger" onClick={() => setAsk({
                title: `Move ${ref} to the recycle bin?`,
                body: `${t.shipper} leaves every list and dashboard but keeps its history. You can restore it from the Recycle bin.`,
                label: "Move to bin",
                go: () => run(() => api.remove(ref).then(onBack), `${ref} moved to the bin`),
              })}>Delete ticket</Btn>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-bold text-[#EE1B2C]">{t.ref}</span>
        <Pill dot>{t.status}</Pill>
        <Pill>{t.service}</Pill>
        {t.needs_review && <Pill tone="bg-violet-50 text-violet-700">PNS review</Pill>}
        <span className="ml-2 text-[12px] text-slate-500">
          Submitted {t.submitted_on} &middot; <Sla elapsed={t.sla_elapsed} target={t.sla_target} />
          {t.owner && <> &middot; PNS {t.owner}</>}
          {t.reviewer && <> &middot; reviewer {t.reviewer}</>}
          {t.psp_assignee && <> &middot; PSP {t.psp_assignee}</>}
        </span>
      </div>

      {/* Why it came back should be the first thing you read, not buried in History. */}
      {t.status.startsWith("Pending") && d.history[0]?.note && (
        <Card className="mb-4 border-l-4 border-l-amber-400 bg-amber-50/50 p-3.5">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-amber-700">
            Last note on this ticket
          </div>
          <p className="mt-1 text-[13px] text-slate-700">{d.history[0].note}</p>
          <p className="mt-1 text-[11.5px] text-slate-500">
            {d.history[0].actor} &middot; {d.history[0].at}
          </p>
        </Card>
      )}

      {/* ---------------------------------------------------------------- actions */}
      {(p.assign || p.assignReviewer || p.setSales || p.pspAssign || (closed && p.reopen)) && (
        <Card className="mb-4 p-4">
          <div className="mb-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Ownership
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {p.assign && (
              <Assigner label="PNS owner" current={t.owner} options={team} busy={busy}
                hint="The PNS Head assigns work — on any ticket, whoever priced it."
                onSet={(v) => run(() => api.assign(ref, { owner: v }),
                  v ? `${ref} assigned to ${v}` : "Owner cleared")} />
            )}
            {p.assignReviewer && (
              <Assigner label="Price reviewer" current={t.reviewer} options={team} busy={busy}
                hint="Who checks a Sales-built price before it goes out."
                onSet={(v) => run(() => api.assign(ref, { reviewer: v }),
                  v ? `${v} will review ${ref}` : "Reviewer cleared")} />
            )}
            {p.setSales && (
              <Assigner label="Sales PIC" current={t.sales} options={opts?.sales || []} busy={busy}
                allowClear={false} hint="Commercial Head can hand the ticket to another salesperson."
                onSet={(v) => run(() => api.setSales(ref, v), `${ref} reassigned to ${v}`)} />
            )}
            {p.pspAssign && (
              <Assigner label="PSP PIC" current={t.psp_assignee} options={psp} busy={busy}
                hint="Any PSP member can take any ticket — no head/staff split in PSP."
                onSet={(v) => run(() => api.pspAssign(ref, v),
                  v ? `${ref} assigned to ${v}` : "PSP PIC cleared")} />
            )}
            {closed && p.reopen && (
              <Assigner label={`Reopen this ${t.status.toLowerCase()} deal`}
                current={null} options={opts?.pending_statuses || []} busy={busy}
                allowClear={false} setLabel="Reopen"
                hint="Commercial Head only. The loss reason is cleared."
                onSet={(v) => run(() => api.reopen(ref, v), `${ref} reopened as ${v}`)} />
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
          {tabs.map(([k, label, badge]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] ${
                tab === k ? "border-[#EE1B2C] font-semibold text-[#EE1B2C]" : "border-transparent text-slate-600"
              }`}>
              {label}
              {badge > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 font-mono text-[11px] font-bold text-amber-800">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "charter" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[12px] text-slate-500">
                  Generated from the intake. {d.input_cleared ? "Input cleared." : "Input not yet cleared."}
                  {" "}Price only — the charter never carries cost or margin.
                </p>
                <Btn onClick={copyCharter}>Copy for email</Btn>
              </div>
              {SECTIONS.map(([label, fields]) => (
                <div key={label} className="mb-5 last:mb-0">
                  <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                  <dl>
                    {fields.map(([k, l]) => (
                      <Row key={k} label={l}>
                        {display(k, i[k]) || <span className="text-slate-400">—</span>}
                      </Row>
                    ))}
                    {label.startsWith("2") && (
                      <Row label="Photos of the goods">
                        {photos.length === 0 ? (
                          <span className="text-slate-400">none attached</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {photos.map((f) => (
                              <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer"
                                title={f.caption || f.filename}>
                                <img src={f.url} alt={f.caption || f.filename} loading="lazy"
                                  className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </Row>
                    )}
                    {label.startsWith("3") && (
                      <Row label="Pricing">
                        <PriceChip file={d.price_file} url={d.price_url} />
                      </Row>
                    )}
                  </dl>
                </div>
              ))}
            </>
          )}

          {/* ------------------------------------------------------------ input */}
          {tab === "input" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[12px] text-slate-500">
                  {!p.editInput
                    ? "Read-only — Commercial and Admin correct the original input."
                    : p.editAcctOrRev
                      ? "You can correct anything here, including account type and revenue."
                      : "Account type and potential revenue are Commercial Head only — they change who owes the price."}
                </p>
                {p.editInput && (
                  draft ? (
                    <span className="flex gap-2">
                      <Btn onClick={() => setDraft(null)}>Cancel</Btn>
                      <Btn kind="primary" disabled={busy} onClick={saveEdit}>Save changes</Btn>
                    </span>
                  ) : (
                    <Btn onClick={startEdit}>Edit input</Btn>
                  )
                )}
              </div>

              <dl>
                <Row label="Service type">
                  {draft ? (
                    <select className={`${inputCls} max-w-[240px]`} value={draft.__service}
                      onChange={(e) => setDraft({ ...draft, __service: e.target.value })}>
                      {SERVICES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  ) : t.service}
                </Row>
                <Row label="Account type">
                  {draft && p.editAcctOrRev ? (
                    <select className={`${inputCls} max-w-[240px]`} value={draft.__acct}
                      onChange={(e) => setDraft({ ...draft, __acct: e.target.value })}>
                      <option>Non-Strategic</option><option>Strategic</option>
                    </select>
                  ) : (
                    <>
                      {t.acct_type}
                      {!p.editAcctOrRev && <span className="ml-2 text-[11px] text-slate-400">🔒 Head only</span>}
                    </>
                  )}
                </Row>
                <Row label="Potential revenue">
                  {draft && p.editAcctOrRev ? (
                    <input className={`${inputCls} max-w-[240px] font-mono`} value={draft.__revenue}
                      onChange={(e) => setDraft({ ...draft, __revenue: e.target.value })} />
                  ) : (
                    <>
                      {rp(t.revenue)}
                      {!p.editAcctOrRev && <span className="ml-2 text-[11px] text-slate-400">🔒 Head only</span>}
                    </>
                  )}
                </Row>
              </dl>

              {SECTIONS.map(([label, fields]) => (
                <div key={label} className="mt-5">
                  <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                  <dl>
                    {fields.map(([k, l]) => (
                      <Row key={k} label={l}>
                        {!draft ? (
                          display(k, i[k]) || <span className="text-slate-400">—</span>
                        ) : HOURS.includes(k) ? (
                          <input type="number" min="0" step="0.5" placeholder="None"
                            className={`${inputCls} max-w-[140px]`} value={draft[k]}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                        ) : LONG.includes(k) ? (
                          <textarea className={`${inputCls} min-h-[56px]`} value={draft[k]}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                        ) : YESNO.includes(k) ? (
                          <select className={`${inputCls} max-w-[140px]`} value={draft[k] || "No"}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
                            <option>Yes</option><option>No</option>
                          </select>
                        ) : remembered[k] ? (
                          <Combo value={draft[k]} options={remembered[k]}
                            placeholder="Type anything — past answers are suggested"
                            onChange={(v) => setDraft({ ...draft, [k]: v })} />
                        ) : (
                          <input className={inputCls} value={draft[k]}
                            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                        )}
                      </Row>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          )}

          {tab === "pricing" && (
            <dl>
              <Row label="Rate card">{d.rate_card || "—"}</Row>
              <Row label="Priced by">{t.priced_by}</Row>
              <Row label="Price spreadsheet">
                <PriceChip file={d.price_file} url={d.price_url} />
              </Row>
              {p.seeMargin ? (
                <>
                  <Row label="Margin">{d.margin == null ? "—" : <b className="font-mono">{d.margin}%</b>}</Row>
                  <Row label="Product bottom margin">
                    {d.bottom_margin == null
                      ? <span className="text-amber-700">not yet defined for {t.service}</span>
                      : <span className="font-mono">{d.bottom_margin}%</span>}
                  </Row>
                </>
              ) : (
                <Row label="Margin and cost">
                  <span className="rounded border border-dashed border-slate-300 px-2 py-0.5 font-mono text-[12px] text-slate-400">
                    🔒 Restricted to PNS, PSP and CSO
                  </span>
                </Row>
              )}
            </dl>
          )}

          {tab === "files" && (
            <Attachments ticketRef={ref} me={me} notify={notify} onCountChange={loadFiles} />
          )}

          {tab === "discussion" && (
            <Discussion ticketRef={ref} me={me} notify={notify} onCountChange={setQCount} />
          )}

          {tab === "history" && (
            <div className="relative pl-5">
              <span className="absolute left-1 top-2 bottom-2 w-px bg-slate-200" />
              {d.history.length === 0 && <p className="text-sm text-slate-400">No history recorded.</p>}
              {d.history.map((h, idx) => (
                <div key={idx} className="relative pb-4 last:pb-0">
                  <span className={`absolute -left-[15px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${
                    idx === 0 ? "border-[#EE1B2C] bg-[#EE1B2C]" : "border-slate-300 bg-white"}`} />
                  <div className="font-mono text-[11px] text-slate-400">{h.at}</div>
                  <div className="mt-0.5"><Pill dot>{h.status}</Pill></div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {h.actor}{h.note ? ` · ${h.note}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Confirm open={!!ask} title={ask?.title} body={ask?.body} confirmLabel={ask?.label}
        onCancel={() => setAsk(null)}
        onConfirm={() => { const go = ask.go; setAsk(null); go(); }} />
    </>
  );
}

/* One row of the ownership panel: pick a value, press the button, done. */
function Assigner({ label, hint, current, options, onSet, busy, allowClear = true, setLabel = "Set" }) {
  const [v, setV] = useState("");
  const choice = v || current || options[0] || "";
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-1 text-[11.5px] font-semibold text-slate-600">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        {options.length === 0 ? (
          <span className="text-[12.5px] text-slate-500">Nobody available yet.</span>
        ) : (
          <>
            <select className={`${inputCls} max-w-[190px]`} value={choice}
              onChange={(e) => setV(e.target.value)}>
              {options.map((n) => <option key={n}>{n}</option>)}
            </select>
            <Btn kind="primary" disabled={busy || !choice} onClick={() => onSet(choice)}>
              {setLabel}
            </Btn>
            {allowClear && current && (
              <Btn disabled={busy} onClick={() => { setV(""); onSet(""); }}>Clear</Btn>
            )}
          </>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        {current ? `Currently ${current}. ` : "Unassigned. "}{hint}
      </p>
    </div>
  );
}
