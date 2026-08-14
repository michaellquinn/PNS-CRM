import { useState } from "react";
import { api, SERVICES, shrinkImage } from "../api";
import { Btn, Card, Combo, Field, Head, inputCls, refreshOptions, useOptions } from "../ui";

const CAPA_SERVICES = ["B2BR (<50kg)", "LTL > 50kg", "FTL", "Same Day - Regular", "Same Day - Premium"];

function Section({ label, children }) {
  return (
    <>
      <div className="mb-3 mt-6 flex items-center gap-3 first:mt-0">
        <span className="whitespace-nowrap text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </>
  );
}

/* ---------------------------------------------------------------- new request */
export function NewRequest({ me, notify, onCreated }) {
  const [f, setF] = useState({
    opportunity_id: "",
    service: "LTL", acct_type: "Standard", region: "GJ", revenue: "48000000",
    project: "One time project", contract: "Short (<= 1 year)",
    sla: "Standard", mps: "Yes", rdo: "Yes", cod: "No", tkbmO: "No", tkbmD: "No",
    ins: "No", pallet: "Non palletized", commodity: "FMCG", destType: "GT",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setV = (k) => (v) => setF({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [docs, setDocs] = useState([]);
  const opts = useOptions();
  const mem = opts?.remembered || {};

  const rev = parseInt(String(f.revenue).replace(/\D/g, ""), 10) || 0;
  const routed = (f.acct_type === "Strategic" || f.acct_type === "Hypercare")
    ? { by: "PNS", review: false }
    : rev >= 30000000
      ? { by: "Sales", review: true }
      : ["FTL monthly", "Sameday"].includes(f.service)
        ? { by: "PNS", review: false }
        : { by: "Sales", review: false };
  // Which watched group this request lands in, mirroring big_group(): the account tier
  // is the stronger claim, so a Hypercare account's must-win deal reads as Hypercare.
  const watched = ["Hypercare", "Strategic"].includes(f.acct_type) ? f.acct_type
    : f.must_win ? "Must Win" : null;

  const submit = async () => {
    if (!f.shipper?.trim()) return notify("Shipper is required");
    if (!f.brief?.trim()) return notify("Brief summary is required");
    setBusy(true);
    try {
      const { shipper, brief, service, acct_type, region, revenue, opportunity_id,
              must_win, ...payload } = f;
      const r = await api.createTicket({
        shipper: shipper.trim(), brief: brief.trim(), service, acct_type, region,
        revenue: rev, sales_email: me.email, must_win: !!must_win,
        opportunity_id: (opportunity_id || "").trim() || null,
        payload: { ...payload, shipper: shipper.trim(), brief: brief.trim() },
      });
      refreshOptions();       // anything newly typed becomes a suggestion next time

      // Attachments need a ticket to hang off, so they go up straight after creation.
      // A failure here must not read as "the ticket failed" — it didn't.
      let attached = 0;
      for (const raw of [...photos, ...docs]) {
        try {
          await api.uploadFile(r.ref, await shrinkImage(raw),
            photos.includes(raw) ? "goods_photo" : "document");
          attached += 1;
        } catch (e) { notify(`${r.ref} created, but ${raw.name} did not attach: ${e.message}`); }
      }
      notify(`${r.ref} created — ${r.status}${attached ? `, ${attached} file(s) attached` : ""}`);
      onCreated(r.ref);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Head title="New request"
        sub="One service per request. The Project Charter is generated once PNS clears the input."
        right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">🔒 Template v1.0</span>}
      />
      <Card className="max-w-4xl p-5">
        <Section label="Request">
          <Field label="Service type" required>
            <select className={inputCls} value={f.service} onChange={set("service")}>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Request truck type" hint="FTL only. Type a body type not listed.">
            <Combo value={f.truck} onChange={setV("truck")} options={mem.truck || []} />
          </Field>
        </Section>

        <Section label="1 · Shipper profile">
          <Field label="Sales CRM opportunity ID" required
            hint="Raise the opportunity in Sales CRM first, then paste its id here. It is the 6-digit number in the record URL, starting with 9 — a long 000000… number is the OLD Salesforce id and will not match anything. Without it the ticket parks in Pending CRM ID and cannot move.">
            <input className={inputCls} value={f.opportunity_id}
              onChange={set("opportunity_id")}
              placeholder="e.g. 906031" />
          </Field>
          <Field label="Shipper" required hint="Existing shippers are suggested as you type">
            <Combo value={f.shipper} onChange={setV("shipper")} options={opts?.shippers || []}
              placeholder="PT …" />
          </Field>
          <Field label="Shipper status" required>
            <select className={inputCls} value={f.shipperStatus || "New shipper"} onChange={set("shipperStatus")}>
              <option>New shipper</option><option>Existing shipper</option>
            </select>
          </Field>
          <Field label="Account type" required hint="Later changes are Commercial Head only">
            <select className={inputCls} value={f.acct_type} onChange={set("acct_type")}>
              <option>Hypercare</option><option>Strategic</option><option>Standard</option>
            </select>
          </Field>
          {/* The third watched group, and the only one that is not an account tier —
              hence a checkbox next to the dropdown rather than a fourth option inside
              it. Hypercare and Strategic describe the ACCOUNT and come down from the
              Sales CRM account group; Must Win describes THIS DEAL, so the same account
              can have a must-win request and five ordinary ones. */}
          <Field label="Must Win"
            hint="Sales CRM carries this as Lead Source Detail “Must Win”, and the sync will overwrite whatever is set here — tick it for a deal that was called in a meeting before anybody edited the opportunity.">
            <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] ${
              f.must_win ? "border-orange-300 bg-orange-50 font-semibold text-orange-900"
                         : "border-slate-300 bg-white text-slate-600"}`}>
              <input type="checkbox" checked={!!f.must_win}
                onChange={(e) => setF({ ...f, must_win: e.target.checked })} />
              This deal is Must Win
            </label>
          </Field>
          <Field label="Project type" required>
            <select className={inputCls} value={f.project} onChange={set("project")}>
              <option>One time project</option><option>Continuation</option>
            </select>
          </Field>
          <Field label="Contract period" required>
            <select className={inputCls} value={f.contract} onChange={set("contract")}>
              <option>Short (&lt;= 1 year)</option><option>Long (&gt; 1 year)</option>
            </select>
          </Field>
          <Field label="Potential revenue" required
            hint={`${routed.by} attaches the price${routed.review ? " · PNS review required" : ""}`}>
            <input className={`${inputCls} font-mono`} value={f.revenue} onChange={set("revenue")} />
          </Field>
          <Field label="Region" required>
            <select className={inputCls} value={f.region} onChange={set("region")}>
              <option>GJ</option><option>WJ</option><option>EJ</option><option>CJ</option>
            </select>
          </Field>
          <Field label="Go-live date" required>
            <input type="date" className={inputCls} value={f.golive || ""} onChange={set("golive")} />
          </Field>
          <Field label="Shipper PIC" required>
            <input className={inputCls} value={f.shipperPic || ""} onChange={set("shipperPic")} />
          </Field>
          <Field label="Contact shipper PIC" required>
            <input className={inputCls} value={f.shipperContact || ""} onChange={set("shipperContact")} placeholder="08xx…" />
          </Field>
          <Field label="Brief summary" required span
            hint="Goes straight onto the Project Charter; it's the first thing PNS reads">
            <textarea className={`${inputCls} min-h-[70px]`} value={f.brief || ""} onChange={set("brief")}
              placeholder="What the shipper is trying to do, in a couple of lines." />
          </Field>
        </Section>

        <div className="mt-3 rounded-lg border-l-2 border-slate-300 bg-slate-50 p-3">
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
            Optional now — required once the bid is won
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Invoicing PIC"><input className={inputCls} value={f.invPic || ""} onChange={set("invPic")} /></Field>
            <Field label="Contact invoicing PIC"><input className={inputCls} value={f.invContact || ""} onChange={set("invContact")} /></Field>
            <Field label="Invoicing address" span><input className={inputCls} value={f.invAddr || ""} onChange={set("invAddr")} /></Field>
            <Field label="Pickup PIC"><input className={inputCls} value={f.pickPic || ""} onChange={set("pickPic")} /></Field>
            <Field label="Contact pickup PIC"><input className={inputCls} value={f.pickContact || ""} onChange={set("pickContact")} /></Field>
          </div>
        </div>

        <Section label="2 · Route &amp; schedule">
          <Field label="Pickup address" required span><input className={inputCls} value={f.pickup || ""} onChange={set("pickup")} /></Field>
          <Field label="Destination" required span><input className={inputCls} value={f.dest || ""} onChange={set("dest")} placeholder="GJ, CJ, EJ" /></Field>
          <Field label="Delivery destination type" required hint="Not listed? Type it">
            <Combo value={f.destType} onChange={setV("destType")} options={mem.destType || []} />
          </Field>
          <Field label="Delivery frequency" required>
            <Combo value={f.freq} onChange={setV("freq")} options={mem.freq || []}
              placeholder="2–3× per week" />
          </Field>
          <Field label="Pickup time slot" required><input className={inputCls} value={f.pickSlot || ""} onChange={set("pickSlot")} /></Field>
          <Field label="Pickup waiting time" hint="Hours the driver waits at origin. Leave empty for none.">
            <input type="number" min="0" step="0.5" className={inputCls}
              value={f.pickWait ?? ""} onChange={set("pickWait")} placeholder="None" />
          </Field>
          <Field label="Delivery time slot" required><input className={inputCls} value={f.delSlot || ""} onChange={set("delSlot")} /></Field>
          <Field label="Delivery waiting time" hint="Hours the driver waits at destination. Leave empty for none.">
            <input type="number" min="0" step="0.5" className={inputCls}
              value={f.delWait ?? ""} onChange={set("delWait")} placeholder="None" />
          </Field>
        </Section>

        <Section label="3 · Cargo knowledge">
          <Field label="Commodity" required
            hint="Type anything (medicine, cosmetics, spare parts). Past answers are suggested.">
            <Combo value={f.commodity} onChange={setV("commodity")} options={mem.commodity || []} />
          </Field>
          <Field label="Specific product" required hint="Free text; remembered for next time">
            <Combo value={f.product} onChange={setV("product")} options={mem.product || []} />
          </Field>
          <Field label="Parcel dimension (cm)" required><input className={inputCls} value={f.dim || ""} onChange={set("dim")} placeholder="35 × 50 × 30" /></Field>
          <Field label="Parcel weight (kg)" required><input className={inputCls} value={f.wt || ""} onChange={set("wt")} /></Field>
          <Field label="Est. volume per month" required><input className={inputCls} value={f.volume || ""} onChange={set("volume")} /></Field>
          <Field label="Palletized" required hint="Not listed? Type it">
            <Combo value={f.pallet} onChange={setV("pallet")} options={mem.pallet || []} />
          </Field>
          <Field label="Photos of the goods" span
            hint="A picture of the actual cartons or pallet answers half the questions PNS would otherwise have to ask. Shrunk automatically before upload.">
            <input type="file" multiple accept="image/*" capture="environment"
              onChange={(e) => setPhotos(Array.from(e.target.files || []))}
              className="w-full text-[12.5px] file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium" />
            {photos.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                {photos.map((p) => p.name).join(", ")}
              </p>
            )}
          </Field>
          <Field label="Supporting documents" span
            hint="Shipper requirement sheets, volume data, existing rate cards. PDF, Word, Excel or CSV, 5 MB each.">
            <input type="file" multiple accept=".pdf,.xlsx,.xls,.docx,.doc,.csv,.txt"
              onChange={(e) => setDocs(Array.from(e.target.files || []))}
              className="w-full text-[12.5px] file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium" />
            {docs.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                {docs.map((p) => p.name).join(", ")}
              </p>
            )}
          </Field>
        </Section>

        <Section label="4 · Ninja's service">
          <Field label="SLA" required>
            <select className={inputCls} value={f.sla} onChange={set("sla")}><option>Standard</option><option>Custom</option></select>
          </Field>
          <Field label="MPS" required>
            <select className={inputCls} value={f.mps} onChange={set("mps")}><option>Yes</option><option>No</option></select>
          </Field>
          <Field label="RDO" required>
            <select className={inputCls} value={f.rdo} onChange={set("rdo")}><option>Yes</option><option>No</option></select>
          </Field>
          <Field label="COD" required>
            <select className={inputCls} value={f.cod} onChange={set("cod")}><option>No</option><option>Yes</option></select>
          </Field>
          <Field label="TKBM origin" required>
            <select className={inputCls} value={f.tkbmO} onChange={set("tkbmO")}><option>No</option><option>Yes</option></select>
          </Field>
          <Field label="TKBM destination" required>
            <select className={inputCls} value={f.tkbmD} onChange={set("tkbmD")}><option>No</option><option>Yes</option></select>
          </Field>
          <Field label="Insurance" required>
            <select className={inputCls} value={f.ins} onChange={set("ins")}><option>No</option><option>Yes</option></select>
          </Field>
          <Field label="Custom handling request" span>
            <textarea className={`${inputCls} min-h-[60px]`} value={f.handling || ""} onChange={set("handling")} />
          </Field>
          <Field label="Notes" span hint="Anything else PNS should know">
            <textarea className={`${inputCls} min-h-[60px]`} value={f.notes || ""} onChange={set("notes")} />
          </Field>
        </Section>

        <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="text-[12px] text-slate-500">
            Routed to <b>{routed.by}</b>
            {/* A watched group changes what happens AFTER the price, not who attaches
                it, so it is stated separately from the routing rather than folded into
                it. Must Win reaches C-level too — Baskoro, 2026-08-13. */}
            {watched
              ? <> · once priced, <b>{watched}</b> goes to the Head of PNS first, then Head of Sales and C-level</>
              : routed.review ? ", then PNS review" : null}
          </span>
          <Btn kind="primary" disabled={busy} onClick={submit}>Submit request</Btn>
        </div>
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- new CAPA */
export function NewCapa({ notify, onCreated }) {
  const [f, setF] = useState({ shipper: "", issue: "", trid: "", link: "", services: [] });
  const [evidence, setEvidence] = useState([]);
  const [busy, setBusy] = useState(false);

  const toggle = (s) =>
    setF({ ...f, services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] });

  const submit = async () => {
    if (!f.shipper.trim() || !f.issue.trim() || !f.services.length)
      return notify("Shipper, service type and issue description are required");
    const url = f.link.trim();
    if (url && !/^https?:\/\//i.test(url))
      return notify("The link must start with http:// or https://");
    setBusy(true);
    try {
      const r = await api.raiseCapa({
        shipper: f.shipper.trim(), services: f.services,
        issue: f.issue.trim(), trid_samples: f.trid.trim() || null,
        link_url: url || null,
      });
      // Evidence needs a CAPA to hang off, so it goes up straight after creation.
      let attached = 0;
      for (const raw of evidence) {
        try { await api.uploadCapaFile(r.ref, await shrinkImage(raw), "evidence"); attached += 1; }
        catch (e) { notify(`${r.ref} raised, but ${raw.name} did not attach: ${e.message}`); }
      }
      notify(`${r.ref} raised — PNS to review${attached ? `, ${attached} file(s) attached` : ""}`);
      onCreated();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Head title="New CAPA" sub="Raise a corrective action for an existing shipper." />
      <Card className="max-w-xl p-5">
        <div className="grid grid-cols-1 gap-4">
          <Field label="Shipper name" required>
            <input className={inputCls} value={f.shipper} onChange={(e) => setF({ ...f, shipper: e.target.value })} />
          </Field>
          <Field label="Service type" required>
            <div className="mt-1 flex flex-col gap-2">
              {CAPA_SERVICES.map((s) => (
                <label key={s} className="flex items-center gap-2.5 text-[13px]">
                  <input type="checkbox" checked={f.services.includes(s)} onChange={() => toggle(s)} />
                  {s}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Issue description" required>
            <textarea className={`${inputCls} min-h-[80px]`} value={f.issue}
              onChange={(e) => setF({ ...f, issue: e.target.value })} />
          </Field>
          <Field label="TRID samples">
            <input className={inputCls} value={f.trid} onChange={(e) => setF({ ...f, trid: e.target.value })}
              placeholder="TRID-88213, TRID-88407" />
          </Field>
          <Field label="Photos or evidence"
            hint="A picture of the damage or the issue. Shrunk automatically before upload.">
            <input type="file" multiple accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv,.txt"
              capture="environment" onChange={(e) => setEvidence(Array.from(e.target.files || []))}
              className="w-full text-[12.5px] file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium" />
            {evidence.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">{evidence.map((p) => p.name).join(", ")}</p>
            )}
          </Field>
          <Field label="Link" hint="Tracking page, shipper complaint thread, shared folder: anything already online.">
            <input className={inputCls} type="url" value={f.link}
              onChange={(e) => setF({ ...f, link: e.target.value })}
              placeholder="https://…" />
          </Field>
        </div>
        <div className="mt-5 flex justify-end border-t border-slate-200 pt-4">
          <Btn kind="primary" disabled={busy} onClick={submit}>Submit CAPA</Btn>
        </div>
      </Card>
    </>
  );
}
