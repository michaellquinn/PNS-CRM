import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Confirm, Empty, Head, Pill, inputCls } from "../ui";

// The sync ignore list. Admin-only and deliberately out of the Solutioning menu: it
// makes deals silently not appear, which is a thing to do rarely and on purpose.
//
// The table has existed since V24 and the permission was wired with it, but nothing ever
// read the table — so "Test Ninja Biz - 1" arrived on every single import and was ignored
// by hand every time. The sync consults it now, and a skip still shows up in the run's
// report with its reason, which is the difference between ignoring a deal and losing one.

export default function Ignored({ notify }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [oid, setOid] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);

  const load = () =>
    api.ignored().then((d) => setRows(d.ignored)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!oid.trim()) return notify("Paste the Sales CRM opportunity id");
    if (!reason.trim()) return notify("Say why it should never be imported");
    setBusy(true);
    try {
      await api.addIgnored(oid.trim(), reason.trim());
      notify(`${oid.trim()} will not be imported again`);
      setOid(""); setReason(""); await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    try { await api.removeIgnored(id); notify(`${id} will be imported again`); await load(); }
    catch (e) { notify(e.message); }
    finally { setAsk(null); }
  };

  return (
    <>
      <Head title="Sync ignore list"
        sub="Sales CRM opportunities the sync must never import. Test records, duplicates raised in error, deals that belong to another country's pipeline."
        right={rows && <span className="text-[12px] text-slate-500">{rows.length} ignored</span>} />

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}

      <Card className="mb-4 p-4">
        <div className="mb-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          Add one
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <input className={`${inputCls} max-w-[200px] font-mono`} value={oid}
            onChange={(e) => setOid(e.target.value)}
            placeholder="Opportunity id, e.g. 906031" />
          <input className={`${inputCls} min-w-[260px] flex-1`} value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — required" />
          <Btn kind="primary" disabled={busy} onClick={add}>Never import this</Btn>
        </div>
        <p className="mt-2 text-[11.5px] text-slate-400">
          The reason is required for the same purpose it is on a PSP exception: an entry
          with no recorded why is indistinguishable, months later, from a misclick — and
          this one makes a deal stop appearing.
        </p>
      </Card>

      {/* Ignoring stops future imports; it does not delete anything already here. Saying
          so on the screen rather than leaving somebody to conclude the list is broken. */}
      <Card className="mb-4 border-l-4 border-l-amber-400 bg-amber-50/50 p-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-amber-700">
          What this does and does not do
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
          The sync will not create or refresh a ticket for an id on this list, and every
          run reports the skip with its reason so nobody wonders where a deal went. It
          does <b>not</b> delete a ticket that was already imported before the id was
          added — those are marked below, and removing them is a separate decision on the
          Recycle bin.
        </p>
      </Card>

      {rows === null && !err && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && (
        <Empty>Nothing ignored. Every Sales CRM opportunity is eligible for import.</Empty>
      )}
      {rows && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {["Opportunity", "Why", "Added by", "Added", "Already imported", ""].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.opportunity_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-[12px]">{r.opportunity_id}</td>
                  <td className="px-4 py-3 text-slate-600">{r.reason || "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.added_by}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {String(r.added_at).slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    {r.ticket_ref
                      ? <Pill tone="bg-amber-50 text-amber-700">{r.ticket_ref} still exists</Pill>
                      : <span className="text-slate-400">never imported</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Btn onClick={() => setAsk(r)}>Stop ignoring</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Confirm open={!!ask}
        title={`Import ${ask?.opportunity_id} again?`}
        body={`It was ignored because: ${ask?.reason || "no reason recorded"}. The next sync will pick it up and raise a ticket for it.`}
        confirmLabel="Stop ignoring"
        onConfirm={() => remove(ask.opportunity_id)}
        onCancel={() => setAsk(null)} />
    </>
  );
}
