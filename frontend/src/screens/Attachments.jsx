import { useEffect, useRef, useState } from "react";
import { api, shrinkImage } from "../api";
import { Btn, Card, Empty, inputCls } from "../ui";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,.pdf,.xlsx,.xls,.docx,.doc,.csv,.txt";

const kb = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const ICON = { pdf: "📕", xlsx: "📗", xls: "📗", csv: "📗", docx: "📘", doc: "📘", txt: "📄" };
const iconFor = (name) => ICON[String(name).split(".").pop().toLowerCase()] || "📎";

export default function Attachments({ ticketRef, me, notify, onCountChange }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("goods_photo");
  const [caption, setCaption] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const input = useRef(null);

  const load = () =>
    api.files(ticketRef)
      .then((d) => { setFiles(d.files); onCountChange?.(d.files.length); })
      .catch((e) => setErr(e.message));

  useEffect(() => { setFiles(null); setErr(null); load(); }, [ticketRef]);

  const send = async (list) => {
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    setBusy(true);
    let ok = 0;
    for (const raw of chosen) {
      try {
        const f = await shrinkImage(raw);
        await api.uploadFile(ticketRef, f, kind, caption);
        ok += 1;
      } catch (e) {
        notify(`${raw.name}: ${e.message}`);
      }
    }
    if (ok) notify(ok === 1 ? "Attached" : `${ok} files attached`);
    setCaption("");
    if (input.current) input.current.value = "";
    setBusy(false);
    await load();
  };

  const remove = async (f) => {
    try { await api.deleteFile(f.id); notify(`${f.filename} removed`); await load(); }
    catch (e) { notify(e.message); }
  };

  if (err) return <p className="text-[13px] text-rose-700">{err}</p>;
  if (!files) return <p className="text-sm text-slate-400">Loading…</p>;

  const photos = files.filter((f) => f.kind === "goods_photo");
  const docs = files.filter((f) => f.kind !== "goods_photo");

  const Tile = ({ f }) => (
    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button onClick={() => setLightbox(f)} className="block w-full">
        <img src={f.url} alt={f.caption || f.filename} loading="lazy"
          className="h-36 w-full bg-slate-50 object-cover" />
      </button>
      <figcaption className="p-2">
        <p className="truncate text-[12px] font-medium">{f.caption || f.filename}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {f.uploaded_by} · {kb(f.size_bytes)}
        </p>
        <div className="mt-1.5 flex gap-2">
          <a href={f.url} target="_blank" rel="noopener noreferrer"
            className="text-[11.5px] text-sky-700 hover:underline">Open</a>
          {(f.uploaded_by === me.name || me.permissions.deleteTicket) && (
            <button onClick={() => remove(f)} className="text-[11.5px] text-rose-600 hover:underline">
              Remove
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );

  return (
    <>
      <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="text-[11.5px] font-semibold text-slate-600">
            What are you attaching?
            <select className={`${inputCls} mt-1 max-w-[190px]`} value={kind}
              onChange={(e) => setKind(e.target.value)}>
              <option value="goods_photo">Photo of the goods</option>
              <option value="document">Supporting document</option>
            </select>
          </label>
          <label className="min-w-[200px] flex-1 text-[11.5px] font-semibold text-slate-600">
            Caption (optional)
            <input className={`${inputCls} mt-1`} value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. palletised cartons, 40x30x28" />
          </label>
          <input ref={input} type="file" multiple accept={ACCEPT} disabled={busy}
            onChange={(e) => send(e.target.files)}
            className="text-[12.5px] file:mr-2 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium" />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {busy
            ? "Uploading…"
            : "Photos are shrunk in your browser before upload, so a phone picture is fine. " +
              "5 MB per file. Images, PDF, Word, Excel, CSV and text."}
        </p>
      </div>

      {files.length === 0 && <Empty>Nothing attached to this ticket yet.</Empty>}

      {photos.length > 0 && (
        <>
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Goods · {photos.length}
          </div>
          <div className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
            {photos.map((f) => <Tile key={f.id} f={f} />)}
          </div>
        </>
      )}

      {docs.length > 0 && (
        <>
          <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Documents · {docs.length}
          </div>
          <div className="flex flex-col gap-2">
            {docs.map((f) => (
              <Card key={f.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="text-lg">{iconFor(f.filename)}</span>
                <div className="min-w-0 flex-1">
                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                    className="block truncate text-[13px] font-medium text-sky-800 hover:underline">
                    {f.filename}
                  </a>
                  <p className="text-[11.5px] text-slate-400">
                    {f.caption ? `${f.caption} · ` : ""}{f.uploaded_by} · {kb(f.size_bytes)} · {f.at}
                  </p>
                </div>
                {(f.uploaded_by === me.name || me.permissions.deleteTicket) && (
                  <Btn kind="danger" onClick={() => remove(f)}>Remove</Btn>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-6"
          onClick={() => setLightbox(null)}>
          <figure className="max-h-full max-w-4xl overflow-auto rounded-xl bg-white p-2">
            <img src={lightbox.url} alt={lightbox.caption || lightbox.filename}
              className="max-h-[75vh] w-auto rounded-lg" />
            <figcaption className="px-1 py-2 text-[12.5px] text-slate-600">
              {lightbox.caption || lightbox.filename} — {lightbox.uploaded_by}, {lightbox.at}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
