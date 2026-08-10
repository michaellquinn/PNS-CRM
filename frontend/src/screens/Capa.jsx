import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head, Pill, Tile, inputCls, usePnsTeam } from "../ui";
import Attachments from "./Attachments";

const CAPA_KINDS = [["evidence", "Evidence photo"], ["document", "Supporting document"]];

const TITLES = {
  all: ["CAPA — all", "Corrective actions on existing shippers. Separate from solutioning — no pricing, no routing."],
  new: ["CAPA — new", "Raised by Commercial, waiting on PNS to assign an owner and submit a proposal."],
  submitted: ["CAPA — submitted", "PNS has proposed the corrective action. Sales verifies, then closes it."],
  closed: ["CAPA closed", "Verified and closed. Kept for shipper history."],
};

const FILTER = { new: "Pending PNS", submitted: "Submitted", closed: "CAPA Closed" };

export default function Capa({ view, me, notify, onRaise }) {
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState([]);
  const [err, setErr] = useState(null);
  const [prop, setProp] = useState({});
  const [who, setWho] = useState({});
  const [link, setLink] = useState({});
  const [openFiles, setOpenFiles] = useState(null);
  const team = usePnsTeam();

  const reload = () => {
    api.capa().then((d) => setAll(d.capa)).catch(() => {});
    api.capa(FILTER[view]).then((d) => setRows(d.capa)).catch((e) => setErr(e.message));
  };
  useEffect(() => { setRows(null); reload(); }, [view]);

  const act = async (fn) => { try { await fn(); notify("Done"); reload(); } catch (e) { notify(e.message); } };

  const count = (s) => all.filter((c) => c.status === s).length;
  const [title, sub] = TITLES[view];

  return (
    <>
      <Head title={title} sub={sub}
        right={me.permissions.capaRaise && view === "all"
          ? <Btn kind="primary" onClick={onRaise}>+ Raise CAPA</Btn> : null} />

      {view === "all" && (
        <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
          <Tile label="New" value={count("Pending PNS")} sub="waiting on PNS" />
          <Tile label="Submitted" value={count("Submitted")} sub="awaiting sales" />
          <Tile label="Closed" value={count("CAPA Closed")} sub="cumulative" tone="text-emerald-600" />
          <Tile label="Total" value={all.length} sub="all time" />
        </div>
      )}

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}
      {rows === null && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && <Empty>Nothing here.</Empty>}

      <div className="flex flex-col gap-3">
        {(rows || []).map((c) => (
          <Card key={c.ref} className="p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-bold">{c.ref}</span>
              <Pill dot>{c.status}</Pill>
              {c.assignee && <Pill tone="bg-violet-50 text-violet-700">{c.assignee}</Pill>}
            </div>
            <h3 className="text-[15px] font-semibold">{c.shipper}</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {c.services.join(" · ")} &middot; raised by {c.raised_by} &middot; {c.submitted_on}
            </p>

            <dl className="mt-3 border-t border-slate-100 pt-3 text-[13px]">
              <div className="mb-1.5"><span className="text-slate-500">Issue: </span>{c.issue}</div>
              {c.proposal && <div className="mb-1.5"><span className="text-slate-500">PNS proposal: </span>{c.proposal}</div>}
              {c.link_url && (
                <div>
                  <span className="text-slate-500">Link: </span>
                  <a href={c.link_url} target="_blank" rel="noopener noreferrer"
                    className="break-all font-medium text-sky-800 hover:underline">{c.link_url}</a>
                </div>
              )}
            </dl>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <button onClick={() => setOpenFiles(openFiles === c.ref ? null : c.ref)}
                className="text-[12.5px] font-medium text-sky-800 hover:underline">
                {openFiles === c.ref ? "Hide" : "Attachments"}
                {c.file_count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 font-mono text-[11px] text-slate-600">
                    {c.file_count}
                  </span>
                )}
              </button>
              {openFiles === c.ref && (
                <div className="mt-3">
                  <Attachments
                    ticketRef={c.ref} me={me} notify={notify} onCountChange={reload}
                    kinds={CAPA_KINDS} primaryKind="evidence" primaryLabel="Evidence"
                    emptyText="No photos or documents attached to this CAPA yet."
                    list={api.capaFiles} send={api.uploadCapaFile} remove={api.deleteCapaFile}
                  />
                </div>
              )}
            </div>

            {c.status === "Pending PNS" && me.permissions.capaSubmit && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <select className={`${inputCls} max-w-[160px]`} value={who[c.ref] || c.assignee || team[0] || ""}
                  onChange={(e) => setWho({ ...who, [c.ref]: e.target.value })}>
                  {team.map((n) => <option key={n}>{n}</option>)}
                </select>
                <input className={`${inputCls} max-w-[380px]`} placeholder="Proposal — what will be done"
                  value={prop[c.ref] || ""} onChange={(e) => setProp({ ...prop, [c.ref]: e.target.value })} />
                <input className={`${inputCls} max-w-[280px]`} type="url"
                  placeholder="Link (optional) — https://…"
                  value={link[c.ref] || ""} onChange={(e) => setLink({ ...link, [c.ref]: e.target.value })} />
                <Btn kind="primary" disabled={!team.length} onClick={() => act(() => api.submitCapa(c.ref, {
                  assignee: who[c.ref] || c.assignee || team[0],
                  proposal: (prop[c.ref] || "").trim(),
                  link_url: (link[c.ref] || "").trim() || null,
                }))}>
                  Submit proposal
                </Btn>
              </div>
            )}

            {c.status === "Submitted" && me.permissions.capaClose && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <span className="text-[12px] text-slate-500">
                  PNS submitted the proposal. Close it when verified.
                </span>
                <Btn kind="primary" className="ml-auto" onClick={() => act(() => api.closeCapa(c.ref))}>
                  Close CAPA
                </Btn>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
