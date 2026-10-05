import { useState } from "react";
import { api, SERVICES } from "../api";
import { Btn, Card, Head, inputCls } from "../ui";
import { OperationalList } from "./OperationalOnboarding";

/* New onboarding (Michael, 2026-10-05).

   Not every deal needs solutioning, but every launch needs onboarding. This is the second
   way in: Sales or AM raise a launch straight into onboarding for a deal that never had a
   solutioning ticket. The other way in is Go live from Solutioning.

   No full Project Charter — most of it is about the solution and the price, which a deal
   like this does not have. Only the five charter answers onboarding reads are asked here,
   plus the Sales CRM opportunity id, which is required: it is what supplies the account,
   the Sales PIC and the region. After this the onboarding form opens, exactly as it does
   for any won deal, and submitting it sends the launch to Ops Readiness. */

// Mirrors the options on the onboarding form (OB_FIELDS in the backend). The server
// checks them again, so a mismatch is refused rather than stored.
const SHIPMENT_MODES = ["Port to Port", "Port to Door", "Door to Port", "Door to Door"];
const YES_NO = ["Yes", "No"];

const EMPTY = { opportunity_id: "", service: "", product_type: "", delivery_mode: "",
  mps: "", rdo: "", pickup_frequency: "" };

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

export default function NewOnboarding({ me, notify, onOpen }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const missing = Object.keys(EMPTY).filter((k) => !String(f[k]).trim());

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.newOnboarding(f);
      notify(`${r.ref} created — fill in the onboarding form and submit it`);
      setF(EMPTY);
      onOpen(r.ref);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const select = (k, options) => (
    <select className={inputCls} value={f[k]} onChange={set(k)}>
      <option value="">Choose…</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <>
      <Head title="New onboarding"
        sub="For a deal going live without a solutioning ticket. Every launch needs onboarding; this is how one starts when it did not come through solutioning." />
      <Card className="mb-6 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sales CRM opportunity id" hint="Required. The account, Sales PIC and region come from Sales CRM.">
            <input className={inputCls} inputMode="numeric" placeholder="e.g. 907113"
              value={f.opportunity_id} onChange={set("opportunity_id")} />
          </Field>
          <Field label="Ninja service">{select("service", SERVICES)}</Field>
        </div>
        <p className="mb-2 mt-5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          Charter basics — the Project Charter answers onboarding reads
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product type">
            <input className={inputCls} placeholder="e.g. Dry goods, household" value={f.product_type} onChange={set("product_type")} />
          </Field>
          <Field label="Shipment mode">{select("delivery_mode", SHIPMENT_MODES)}</Field>
          <Field label="MPS">{select("mps", YES_NO)}</Field>
          <Field label="RDO">{select("rdo", YES_NO)}</Field>
          <Field label="Shipment frequency">
            <input className={inputCls} placeholder="e.g. Daily, 3x a week" value={f.pickup_frequency} onChange={set("pickup_frequency")} />
          </Field>
        </div>
        {err && <p className="mt-4 text-[13px] text-rose-700">{err}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Btn kind="primary" disabled={busy || missing.length > 0} onClick={create}>
            {busy ? "Checking Sales CRM…" : "Create and open the onboarding form"}
          </Btn>
          {missing.length > 0 && <span className="text-[12px] text-slate-400">Every field is required.</span>}
        </div>
      </Card>
      {/* This salesperson's — and everyone's, for Admin — launches raised here and not
          submitted yet. Submitted ones move on to Ops Readiness. */}
      <OperationalList view="direct" me={me} notify={notify} onOpen={onOpen} />
    </>
  );
}
