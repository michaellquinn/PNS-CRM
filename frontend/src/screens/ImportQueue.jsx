import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

/* Sales say which deals to bring in (Baskoro, 2026-08-28).
 *
 * The sync used to import every opportunity it could map from the last couple of days,
 * so the board filled with deals nobody had asked PNS to look at and the real work was
 * buried in them. Sales raise the opportunity in Sales CRM — they are the ones who know
 * its id and when it is ready — so they queue it here and the automatic sync imports what
 * is queued and discovers nothing on its own.
 *
 * This is deliberately its own screen rather than a panel on Sync. Sync runs the sweep
 * under one person's API key and is owner-only; queueing a deal is Sales' everyday job.
 * They are different acts and they need different permissions.
 *
 * Refreshing tickets already on the board is NOT governed by this and never should be: a
 * deal that is here must keep learning that it was won, lost or repriced in Sales CRM.
 */
const STATE_TONE = {
  pending: "bg-amber-50 text-amber-700",
  imported: "bg-emerald-50 text-emerald-700",
  skipped: "bg-slate-100 text-slate-600",
  failed: "bg-rose-50 text-rose-700",
};

const SETTING_LABELS = [
  ["sync.queue_only", "Only import what is queued",
   "On: the automatic sync creates a ticket only for an opportunity queued here. Off: it imports everything it finds in its window, and this queue is just a shortcut."],
  ["sync.auto_enabled", "Run the sync automatically",
   "Off stops the timer entirely. Manual runs from the Sync screen still work."],
  ["sync.watched_only", "Watched groups only",
   "Narrow the automatic run to Hypercare, Strategic and Must Win."],
];

const NUMBER_SETTINGS = [
  ["sync.every_minutes", "Run every (minutes)", 1, 1440,
   "How often the timer fires. A run has a 25-second budget; do not set this below the time a run actually takes."],
  ["sync.days", "Look back (days)", 1, 60,
   "How far back each automatic run looks for new opportunities. Ignored while the queue governs imports."],
];

export default function ImportQueue({ me, notify, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ids, setIds] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSaving] = useState(false);

  const load = () => api.syncQueue().then((d) => { setData(d); setErr(null); })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); api.settings().then(setSettings).catch(() => {}); }, []);

  const submit = async () => {
    if (!ids.trim()) return;
    setBusy(true);
    try {
      const r = await api.queueSync(ids, note);
      setResult(r);
      setIds("");
      setNote("");
      notify(r.added.length
        ? `${r.added.length} queued`
        : "Nothing new to queue — see the notes below");
      await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const saveSetting = async (name, value) => {
    setSaving(true);
    try {
      await api.setSettings({ [name]: value });
      setSettings(await api.settings());
      await load();
      notify("Saved");
    } catch (e) { notify(e.message); }
    finally { setSaving(false); }
  };

  const rows = data?.queue || [];
  const editable = settings?.editable;
  const s = settings?.settings || {};

  return (
    <>
      <Head title="Import queue"
        sub="Paste the Sales CRM opportunity ids you want PNS to work. The sync brings them in." />

      {/* Said at the top, because a screen full of queued deals on an app that is still
          importing everything it finds would be a lie of omission. */}
      {data && !data.queue_only && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4">
          <p className="text-[13px] text-amber-900">
            <b>The queue is not governing imports yet.</b> The sync is still importing
            every opportunity it finds in its window, so queueing a deal here only
            guarantees it is fetched — it does not stop anything else arriving.
            {editable
              ? " Turn on “Only import what is queued” below to change that."
              : " The Head of PNS can turn that on."}
          </p>
        </Card>
      )}

      <Card className="mb-4 p-4">
        <label className="mb-1.5 block text-[12.5px] font-semibold">
          Sales CRM opportunity ids
        </label>
        <textarea className={`${inputCls} min-h-[92px] w-full font-mono`}
          placeholder={"906031\n906885\nhttps://salescrm.ninjavan.co/nv/objects/Opportunity/records/907019"}
          value={ids} onChange={(e) => setIds(e.target.value)} />
        <p className="mt-1.5 text-[11.5px] text-slate-500">
          One per line, commas, or paste the record URLs straight from your tabs — the id
          is the number at the end of the address. A long zero-padded number is the old
          Salesforce id and will be refused with that reason.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className={`${inputCls} min-w-[240px] flex-1`} value={note}
            placeholder="Note (optional) — why these, or what PNS should know"
            onChange={(e) => setNote(e.target.value)} />
          <Btn kind="primary" disabled={busy || !ids.trim()} onClick={submit}>
            Add to queue
          </Btn>
        </div>
      </Card>

      {result && (
        <Card className="mb-4 p-4 text-[12.5px]">
          {result.added.length > 0 && (
            <p className="text-emerald-700">
              <b>Queued:</b> {result.added.join(", ")}
            </p>
          )}
          {result.already.length > 0 && (
            <p className="text-slate-600"><b>Already queued:</b> {result.already.join(", ")}</p>
          )}
          {result.existing.length > 0 && (
            <p className="text-slate-600"><b>Already on the board:</b> {result.existing.join("; ")}</p>
          )}
          {result.rejected.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-rose-700">
              {result.rejected.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Queue</h3>
          <Pill tone="bg-amber-50 text-amber-700">{data?.pending ?? 0} waiting</Pill>
        </div>
        <div className="overflow-x-auto">
          {err && <p className="p-4 text-[13px] text-rose-700">{err}</p>}
          {!err && rows.length === 0 && <Empty>Nothing queued.</Empty>}
          {rows.length > 0 && (
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2">Opportunity</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">What happened</th>
                  <th className="px-4 py-2">Asked by</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.opportunity_id} className="border-b border-slate-100">
                    <td className="px-4 py-2.5 font-mono">{r.opportunity_id}</td>
                    <td className="px-4 py-2.5">
                      <Pill tone={STATE_TONE[r.state] || "bg-slate-100 text-slate-600"}>
                        {r.state}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {r.ticket_ref ? (
                        <button className="font-semibold text-[#EE1B2C] hover:underline"
                          onClick={() => onOpen?.(r.ticket_ref)}>
                          {r.ticket_ref}
                        </button>
                      ) : null}
                      {r.ticket_ref && r.detail ? " · " : ""}
                      {r.detail}
                      {r.note ? <span className="block text-slate-400">{r.note}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {r.added_by_name || r.added_by}
                      <span className="block font-mono text-[11px] text-slate-400">
                        {r.created_at?.slice(0, 16)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/* Removing a row that has already been imported would not remove
                          the ticket, so it is only offered while the request is still
                          outstanding. */}
                      {r.state === "pending" && (
                        <button className="text-[12px] text-slate-500 hover:text-rose-700"
                          onClick={async () => {
                            try { await api.unqueueSync(r.opportunity_id); await load(); }
                            catch (e) { notify(e.message); }
                          }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {settings && (
        <Card className="p-4">
          <h3 className="text-[13.5px] font-semibold">What the automatic sync imports</h3>
          <p className="mb-3 text-[11.5px] text-slate-500">
            {editable
              ? "Changes take effect on the next run — no deploy. These are stored in the database, not on one server, so every replica reads the same answer."
              : "Read-only for you. The Head of PNS sets these."}
          </p>
          <div className="flex flex-col gap-2.5">
            {SETTING_LABELS.map(([name, label, hint]) => (
              <label key={name} className="flex items-start gap-2.5 text-[13px]">
                <input type="checkbox" className="mt-1" disabled={!editable || savingSettings}
                  checked={s[name] === "1"}
                  onChange={(e) => saveSetting(name, e.target.checked ? "1" : "0")} />
                <span>
                  <b>{label}</b>
                  <span className="block text-[11.5px] text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {NUMBER_SETTINGS.map(([name, label, min, max, hint]) => (
                <label key={name} className="text-[13px]">
                  <b>{label}</b>
                  <input className={`${inputCls} mt-1 w-full`} type="number"
                    min={min} max={max} disabled={!editable || savingSettings}
                    defaultValue={s[name]}
                    onBlur={(e) => {
                      if (e.target.value !== s[name]) saveSetting(name, e.target.value);
                    }} />
                  <span className="block text-[11.5px] text-slate-500">{hint}</span>
                </label>
              ))}
              <label className="text-[13px]">
                <b>Import floor</b>
                <input className={`${inputCls} mt-1 w-full`} type="date"
                  disabled={!editable || savingSettings} defaultValue={s["sync.min_date"]}
                  onBlur={(e) => {
                    if (e.target.value !== s["sync.min_date"])
                      saveSetting("sync.min_date", e.target.value);
                  }} />
                <span className="block text-[11.5px] text-slate-500">
                  Nothing raised in Sales CRM before this date is imported by a sweep.
                  Naming an id — queueing it, or typing it on the Sync screen — brings the
                  deal in whatever its age. Blank removes the floor entirely.
                </span>
              </label>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
