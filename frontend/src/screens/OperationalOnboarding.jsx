import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

const TITLES = { onboarding: "Onboarding", readiness: "Pending Readiness", golive: "Go Live", handover: "To Handover — QC" };
const HELP = { onboarding: "One opportunity per entry. Open the ticket to complete Sales requirements and follow operational readiness.",
  readiness: "Your team's outstanding confirmations. CL: packing · Sort: TKBM · pickup/delivery operations: fleet and documents.",
  golive: "Ready or approved with exception, awaiting Sales actual go-live confirmation. The seven-day monitoring period follows actual go-live.",
  handover: "Seven-day monitoring has finished. QC opens the ticket and explicitly accepts the operational handover." };
const format = (v) => v ? String(v).replace("T", " ").slice(0, 16) + (String(v).length > 10 ? " WIB" : "") : "—";

export function OperationalList({ view = "onboarding", me, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api.operationalList(view).then(setData).catch(e => setErr(e.message));
  }, [view]);
  if (err) return <Empty>{err}</Empty>;
  const rows = (data?.rows || []).filter(r => (!filter || r.status === filter) && `${r.ref} ${r.opportunity_name} ${r.shipper}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <Head title={TITLES[view]} sub={HELP[view]} right={data && <Pill>{rows.length} opportunities</Pill>} />
    <div className="mb-4 flex flex-wrap gap-2">
      <input className={`${inputCls} max-w-sm`} placeholder="Search opportunity or shipper" value={query} onChange={e => setQuery(e.target.value)} />
      {view === "onboarding" && <select className={`${inputCls} max-w-xs`} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">All onboarding</option>
        {["Awaiting Sales Input", "Pending Readiness", "Ready", "Approved with exception", "Monitoring · 7 days", "To Handover — QC", "QC accepted"].map(v => <option key={v}>{v}</option>)}
      </select>}
    </div>
    {!data ? <p>Loading…</p> : !rows.length ? <Empty>No opportunities waiting here.</Empty> : <div className="space-y-3">
      {rows.map(r => <Card key={r.ref} className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="font-mono font-semibold text-[#EE1B2C] hover:underline" onClick={() => onOpen(r.ref)}>{r.ref}</button>
          <Pill>{r.status}</Pill>{r.overdue && <Pill tone="bg-rose-100 text-rose-800">Confirmation overdue</Pill>}
          <Btn className="ml-auto" onClick={() => onOpen(r.ref)}>Open onboarding</Btn>
        </div>
        <h3 className="mt-2 text-[15px] font-semibold">{r.opportunity_name}</h3>
        <p className="mt-1 text-[12px] text-slate-500">CRM {r.opportunity_id || "—"} · {r.shipper} · {r.service} · Sales {r.sales || "unassigned"}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 text-[12px] text-slate-600">
          <span>First pickup: {format(r.pickup_at)}</span>
          {r.deadline && <span>Confirm by: {format(r.deadline)} (always before pickup)</span>}
          {r.actual_golive && <span>Actual go-live: {r.actual_golive}</span>}
        </div>
        {!!r.pending.length && <p className="mt-2 text-[12px] text-amber-800">Outstanding: {r.pending.join(" · ")}</p>}
      </Card>)}
    </div>}
    {/* "Existing monitoring records" stood here until 2026-09-14 (Michael). It listed
        rows from the ORIGINAL onboarding table that had not been migrated and were
        still live -- two of them, both stuck at "Awaiting QC acknowledgement" since
        August, which in that model means the target passed and nobody ever confirmed
        whether the shipper started shipping.

        Removing it does not resolve them. The old Onboarding screen is gone from the
        menu and the ticket's Onboarding tab reads the new process only, so nothing in
        the app lists them any more. GET /api/onboarding-v2/legacy is deliberately left
        in place: it is now the only way to see what is in there. */}
  </>;
}

function Check({ c, me, canEdit, frozen, run }) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [workaround, setWorkaround] = useState("");
  const own = !frozen && me.group === c.owner_group;
  const act = (body) => run(() => api.operationalDecision(c.id, { fingerprint: c.fingerprint, ...body }), "Readiness decision recorded");
  return <div className="rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">{c.label}</b><Pill>{c.owner_group}</Pill>
      <Pill tone={c.approved_at ? "bg-orange-100 text-orange-800" : c.status === "ready" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
        {c.approved_at ? "Approved with exception" : c.status.replaceAll("_", " ")}
      </Pill>
    </div>
    {c.confirmed_name && <p className="mt-1 text-[11px] text-slate-500">{c.confirmed_name} · {format(c.confirmed_at)} · revision {c.revision}</p>}
    {c.note && <p className="mt-2 whitespace-pre-wrap text-[13px]">{c.note}</p>}
    {own && <div className="mt-3 space-y-2">
      <input className={inputCls} placeholder="Readiness note / blocker" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" onClick={() => act({ status: "ready", note })}>Confirm ready</Btn>
        <Btn onClick={() => act({ status: "not_ready", note })}>Not ready</Btn>
        <Btn onClick={() => act({ status: "clarification", note })}>Needs clarification</Btn>
      </div>
    </div>}
    {canEdit && c.status !== "ready" && <details className="mt-3 text-[12px]">
      <summary className="cursor-pointer font-medium">Request an exception</summary>
      <textarea className={`${inputCls} mt-2`} placeholder="Reason, risk, responsible person and scope" value={reason} onChange={e => setReason(e.target.value)} />
      <textarea className={`${inputCls} mt-2`} placeholder="Proposed feasible workaround" value={workaround} onChange={e => setWorkaround(e.target.value)} />
      <Btn onClick={() => act({ action: "request", reason, workaround })}>Send exception request</Btn>
    </details>}
    {c.exception_reason && <div className="mt-3 rounded-lg bg-orange-50 p-3 text-[12px]">
      <b>Exception request</b><p className="whitespace-pre-wrap">{c.exception_reason}</p><p className="mt-1 whitespace-pre-wrap">Alternative: {c.workaround}</p>
      <p className="mt-1">Team feasibility: {c.feasible_by || "awaiting confirmation"}</p>
      <p>Sales Manager approval: {c.approved_by || "awaiting approval"}</p>
      {own && !c.feasible_at && <Btn className="mt-2" onClick={() => act({ action: "feasible" })}>Confirm workaround feasible</Btn>}
      {!frozen && me.permissions.approveOnboardingException && c.feasible_at && !c.approved_at && <Btn kind="primary" className="mt-2" onClick={() => act({ action: "approve" })}>Approve exception</Btn>}
      {!frozen && me.permissions.approveOnboardingException && <Btn className="ml-2 mt-2" onClick={() => { const reason = window.prompt("Reason for rejecting the exception?"); if (reason) act({ action: "reject", note: reason }); }}>Reject exception</Btn>}
    </div>}
  </div>;
}

export function OnboardingPane({ ticketRef, me, notify }) {
  const [data, setData] = useState(null);
  const [p, setP] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [actual, setActual] = useState("");
  const load = (preserveInputs = false) => api.operationalDetail(ticketRef).then(d => { setData(d); if (!preserveInputs) setP(d.payload); setErr(""); }).catch(e => setErr(e.message));
  useEffect(() => { setData(null); setReviewed(false); load(); }, [ticketRef]);
  const run = async (fn, message, preserveInputs = false) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); notify(message); await load(preserveInputs); } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  if (err) return <Empty>{err}</Empty>;
  if (!data) return <p>Loading onboarding…</p>;
  const editable = data.can_edit && data.eligible && !data.actual_golive;
  const set = (key, value) => setP(prev => ({ ...prev, [key]: value }));
  const save = (submit) => run(() => api.operationalSave(ticketRef, { payload: p, revision: data.revision, submit, documents_reviewed: reviewed }), submit ? "Submitted · operational database updated · team confirmations requested" : "Draft saved");
  const upload = (kind, file) => {
    if (!file) return;
    const form = new FormData(); form.append("file", file); form.append("kind", kind);
    run(() => api.operationalUpload(ticketRef, form), "Operational document uploaded", true);
  };
  return <div className={busy ? "pointer-events-none opacity-70" : ""}>
    <div className="mb-4 rounded-xl bg-sky-50 p-4">
      <div className="flex flex-wrap gap-2"><Pill>{data.status}</Pill><Pill>Revision {data.revision}</Pill>{data.submitted_at && <Pill>Database synced on submission</Pill>}</div>
      <p className="mt-2 text-[12px] text-slate-600">Sales submits by D-1 20:00 WIB. Teams confirm the same day or next day 20:00 maximum, always before pickup. Onboarding does not change pricing, status, ownership or ticket approval routing.</p>
      {data.submitted_at && <p className="mt-1 text-[12px]">Requirements submitted: {format(data.submitted_at)}</p>}
      {!data.eligible && <p className="mt-2 font-medium text-amber-800">Input is available when the opportunity is Ready to Ship.</p>}
    </div>
    <h3 className="mb-3 font-semibold">Sales requirements</h3>
    <p className="mb-4 text-[12px] text-slate-500">Every input must have a valid answer before submission. Use “Not required” with an explanation where a treatment/handling requirement does not apply; manpower No requires quantity 0. Verify prefilled Procha/CRM values for this launch. Complexity assessment is entered explicitly until its automatic rule is agreed.</p>
    {[...new Set(data.fields.map(f => f.section))].map(section => <section key={section} className="mb-5">
      <h4 className="mb-3 border-b pb-2 text-[13px] font-semibold text-slate-700">{section}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {data.fields.filter(f => f.section === section).map(f => { const Field = f.type === "packing" ? "div" : "label"; return <Field key={f.key} className={f.type === "textarea" || f.type === "packing" ? "md:col-span-2" : ""}>
          <span className="mb-1 block text-[12px] text-slate-600">{f.label} *</span>
          {f.type === "packing" ? <div className="flex flex-wrap gap-3 rounded-lg border p-3">{f.options.map(tag => <label key={tag} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" disabled={!editable} checked={(p.packing || []).includes(tag)} onChange={e => {
              const tags = p.packing || [];
              set("packing", e.target.checked ? tag === "No" ? ["No"] : [...tags.filter(t => t !== "No"), tag] : tags.filter(t => t !== tag));
            }} />{tag} · {data.packing_labels[tag]}
          </label>)}</div> : f.type === "select" ? <select className={inputCls} disabled={!editable} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)}>
            <option value="">Choose…</option>{f.options.map(v => <option key={v}>{v}</option>)}
          </select> : f.type === "textarea" ? <textarea className={`${inputCls} min-h-[76px]`} disabled={!editable} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)} /> :
          <input className={inputCls} type={f.type} step={f.type === "number" ? "any" : undefined} disabled={!editable || ["opportunity_id", "service"].includes(f.key)} value={p[f.key] ?? ""} onChange={e => set(f.key, e.target.value)} />}
        </Field>; })}
      </div>
    </section>)}
    <section className="mb-5 rounded-xl border p-4">
      <h4 className="mb-2 font-semibold text-[13px]">Operational uploads *</h4>
      <p className="mb-3 text-[12px] text-slate-500">Product photo and all pickup points are required. Only upload operational material without pricing/revenue or commercial documents (5 MB per file).</p>
      {[['product_photo','Product photo'],['pickup_points','All pickup points']].map(([kind,label]) => <div key={kind} className="mb-3">
        <b className="text-[12px]">{label}</b>
        {data.documents.filter(d => d.kind === kind).map(d => <a key={d.id} className="ml-3 text-[12px] text-sky-700 underline" href={`/api/onboarding-v2/documents/${d.id}`} target="_blank" rel="noreferrer">{d.filename}</a>)}
        {editable && !data.submitted_at && <input className="mt-1 block text-[12px]" type="file" accept={kind === "product_photo" ? "image/*" : undefined} onChange={e => upload(kind,e.target.files[0])} />}
      </div>)}
    </section>
    {editable && <div className="mb-6 space-y-3">
      <label className="flex items-start gap-2 text-[12px]"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I verified all requirements for this opportunity and confirm operational uploads contain no pricing, revenue or commercial-only information.</label>
      <div className="flex gap-2"><Btn onClick={() => save(false)}>Save draft</Btn><Btn kind="primary" disabled={!reviewed} onClick={() => save(true)}>{data.submitted_at ? "Submit revised requirements" : "Submit onboarding"}</Btn></div>
      {data.submitted_at && <p className="text-[12px] text-amber-800">Draft edits remain private until resubmitted. Changed requirements will require affected teams to reconfirm.</p>}
    </div>}
    {!!data.checks.length && <section className="mb-6">
      <h3 className="mb-3 font-semibold">Team readiness and exceptions</h3>
      <div className="space-y-3">{data.checks.map(c => <Check key={`${c.id}-${c.fingerprint}`} c={c} me={me} frozen={!!data.actual_golive} canEdit={data.can_edit && !data.actual_golive} run={run} />)}</div>
      <p className="mt-3 text-[12px] text-slate-500">Only the assigned team can confirm. Sales Managers approve exceptions after the team's feasible workaround confirmation. Assign team accounts under Users & roles.</p>
    </section>}
    <section className="mb-5 rounded-xl border p-4">
      <h3 className="font-semibold">Actual go-live and QC handover</h3>
      <p className="mt-2 text-[13px]">Planned: {p.planned_golive || "—"} · Actual: {data.actual_golive || "not yet confirmed"}</p>
      {data.can_edit && !data.actual_golive && data.submitted_at && ["Ready", "Approved with exception"].includes(data.status) && <div className="mt-3 flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} type="date" value={actual} onChange={e => setActual(e.target.value)} />
        <Btn kind="primary" disabled={!actual} onClick={() => { if (window.confirm("Confirm shipping actually started on this date? This starts the monitoring period and locks launch requirements.")) run(() => api.operationalGolive(ticketRef,actual),"Actual go-live recorded"); }}>Confirm actual go-live</Btn>
      </div>}
      {data.actual_golive && <p className="mt-2 text-[12px]">{data.qc_accepted_at ? `QC accepted: ${format(data.qc_accepted_at)}` : data.handover_due ? "Seven-day monitoring finished · awaiting QC acceptance" : "Seven-day PNS/QC monitoring in progress"}</p>}
      {data.handover_due && !data.qc_accepted_at && me.group === "QC" && <Btn kind="primary" className="mt-3" onClick={() => run(() => api.operationalQcAccept(ticketRef),"QC accepted handover")}>QC accepts handover</Btn>}
    </section>
    <details className="text-[12px]"><summary className="cursor-pointer font-semibold">Operational history</summary>{data.events.map((e,n) => <div key={n} className="border-b py-2"><span className="text-slate-500">{format(e.at)} · {e.actor}</span><p className="whitespace-pre-wrap break-words">{e.body}</p></div>)}</details>
  </div>;
}

export function OperationalTicket({ ticketRef, me, notify, onBack }) {
  return <><Head title={`Opportunity ${ticketRef}`} sub="Operational view · commercial tabs, attachments and discussion are restricted" right={<Btn onClick={onBack}>Back</Btn>} />
    <Card><div className="border-b px-4 py-3 font-semibold text-[#EE1B2C]">Onboarding</div><div className="p-4"><OnboardingPane ticketRef={ticketRef} me={me} notify={notify} /></div></Card></>;
}

export function OperationalDatabase({ me, notify, onOpen }) {
  const [data,setData] = useState(null); const [err,setErr] = useState("");
  const [file,setFile] = useState(null); const [preview,setPreview] = useState(null); const [busy,setBusy] = useState(false);
  const load = () => api.operationalMaster().then(setData).catch(e=>setErr(e.message));
  useEffect(()=>{load();},[]);
  const send = async commit => {
    setBusy(true);
    try { const form=new FormData();form.append("file",file);form.append("commit",String(commit));form.append("digest",preview?.digest || "");
      const r=await api.operationalImport(form);if(commit){notify(`Imported ${r.imported} records`);setPreview(null);await load();}else setPreview(r);
    }catch(e){notify(e.message);}finally{setBusy(false);}
  };
  return <><Head title="Operational Database" sub="Reusable opportunity-level records. Automatically updated after Sales submits. No pricing or revenue." />
    {me.permissions.importOperational && <Card className="mb-4 space-y-3 p-4">
      <a className="text-[13px] text-sky-700 underline" href="/api/operational-master/template.xlsx">Download Excel template</a>
      <input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files[0]);setPreview(null);}} className="block text-[13px]" />
      <p className="text-[12px] text-slate-500">Global ID must be text. Opportunity Name + Service must match exactly one eligible CRM opportunity. Preview before import; blank cells, duplicates and conflicts are rejected.</p>
      <Btn disabled={!file || busy} onClick={()=>send(false)}>Preview Excel import</Btn>
      {preview && <div className="text-[12px]"><p>{preview.preview.length} valid rows · {preview.errors.length} errors</p>{preview.errors.map(e=><p className="text-rose-700" key={e}>{e}</p>)}
        {preview.preview.map(r=><p key={r.ref}>{r.action} · {r.ref} · {r.values.join(" · ")}</p>)}
        <Btn kind="primary" disabled={busy || !!preview.errors.length || !preview.preview.length} onClick={()=>send(true)}>Confirm import</Btn>
      </div>}
    </Card>}
    {err && <Empty>{err}</Empty>}
    {data && <Card className="overflow-x-auto"><table className="w-full text-left text-[13px]"><thead><tr>{data.columns.map(c=><th key={c} className="border-b p-3">{c}</th>)}</tr></thead>
      <tbody>{data.rows.map(r=><tr key={r.ticket_id}><td className="p-3 font-mono">{r.global_id}</td><td className="p-3"><button className="text-sky-700 hover:underline" onClick={()=>onOpen(r.ticket_ref)}>{r.opportunity_name}</button></td><td className="p-3">{r.service}</td><td className="p-3">{r.pickup_function}</td><td className="p-3">{r.delivery_function}</td></tr>)}</tbody></table>{!data.rows.length && <Empty>No operational records yet. Sales submission creates them automatically.</Empty>}</Card>}
  </>;
}
