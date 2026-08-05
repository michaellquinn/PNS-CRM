import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Btn, Empty, Pill, inputCls, useDirectory } from "../ui";

const GROUP_TONE = {
  Admin: "bg-rose-50 text-rose-700",
  PNS: "bg-violet-50 text-violet-700",
  Commercial: "bg-sky-50 text-sky-700",
  PSP: "bg-amber-50 text-amber-700",
  CSO: "bg-teal-50 text-teal-700",
  Legal: "bg-slate-100 text-slate-600",
};

const MENTION = /(@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// Separate, non-global copy: `.test` on a /g regex carries lastIndex between calls and
// would give alternating answers inside a map.
const IS_MENTION = /^@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const initials = (name) =>
  (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Render @email as a highlight without touching innerHTML — the body is user input.
function Body({ text }) {
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
      {text.split(MENTION).map((part, i) =>
        IS_MENTION.test(part) ? (
          <span key={i} className="rounded bg-sky-50 px-1 font-medium text-sky-800">{part}</span>
        ) : (
          part
        )
      )}
    </p>
  );
}

export default function Discussion({ ticketRef, me, notify, onCountChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [isQuestion, setIsQuestion] = useState(false);
  const [tags, setTags] = useState([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const people = useDirectory();
  const box = useRef(null);

  const load = () =>
    api.comments(ticketRef)
      .then((d) => { setData(d); onCountChange?.(d.open_questions); })
      .catch((e) => setErr(e.message));

  useEffect(() => { setData(null); setErr(null); load(); }, [ticketRef]);

  const post = async () => {
    if (!text.trim()) return notify("Write something first");
    setBusy(true);
    try {
      const r = await api.addComment(ticketRef, {
        body: text.trim(), is_question: isQuestion, mentions: tags,
      });
      setText(""); setTags([]); setIsQuestion(false);
      notify(r.status ? `Posted — ${r.status}` : "Posted");
      await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const resolve = async (id) => {
    try { await api.resolveComment(id); notify("Marked answered"); await load(); }
    catch (e) { notify(e.message); }
  };

  const addTag = (email) => {
    if (!email) return;
    if (!tags.includes(email)) setTags([...tags, email]);
    setPick("");
    // Put the handle in the text too, so the thread reads like the notification did.
    setText((t) => (t.includes(`@${email}`) ? t : `${t}${t && !t.endsWith(" ") ? " " : ""}@${email} `));
    box.current?.focus();
  };

  if (err) return <p className="text-[13px] text-rose-700">{err}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const untagged = people.filter((p) => p.email !== me.email && !tags.includes(p.email));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-[12px] text-slate-500">
          Anything the ticket does not make clear, work it out here. Every group can read
          and post — Commercial, PNS, PSP, Legal and CSO — and the thread stays open after
          a proposal is accepted, which is when the cross-department questions usually
          start.
        </p>
        {data.open_questions > 0 && (
          <Pill tone="bg-amber-50 text-amber-700">
            {data.open_questions} unanswered
          </Pill>
        )}
      </div>

      {data.comments.length === 0 && <Empty>No questions on this ticket yet.</Empty>}

      <div className="flex flex-col gap-3">
        {data.comments.map((c) => {
          const open = c.is_question && !c.resolved_at;
          return (
            <div key={c.id}
              className={`rounded-xl border p-3.5 ${
                open ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                  {initials(c.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <b className="text-[13px]">{c.author}</b>
                    <Pill tone={GROUP_TONE[c.group]}>{c.group}</Pill>
                    {c.is_question && (
                      <Pill tone={open ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}>
                        {open ? "Question" : "Answered"}
                      </Pill>
                    )}
                    <span className="font-mono text-[11px] text-slate-400">{c.at}</span>
                  </div>
                  <Body text={c.body} />
                  {c.mentions.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Notified: {c.mentions.join(", ")}
                    </p>
                  )}
                  {c.resolved_at && (
                    <p className="mt-1.5 text-[11px] text-emerald-700">
                      Closed by {c.resolved_by} · {c.resolved_at}
                    </p>
                  )}
                </div>
                {open && (
                  <Btn onClick={() => resolve(c.id)}>Mark answered</Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------------------------- composer */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5">
        <textarea ref={box} className={`${inputCls} min-h-[76px]`} value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask a question or reply. Tag someone with @their.email@ninjavan.co" />

        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400">Will notify:</span>
            {tags.map((e) => (
              <button key={e} onClick={() => setTags(tags.filter((x) => x !== e))}
                className="rounded-full bg-sky-50 px-2 py-0.5 text-[11.5px] font-medium text-sky-800 hover:line-through">
                {e} ×
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <select className={`${inputCls} max-w-[260px]`} value={pick}
            onChange={(e) => addTag(e.target.value)}>
            <option value="">Tag someone…</option>
            {untagged.map((p) => (
              <option key={p.email} value={p.email}>{p.name} — {p.group}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[12.5px] font-medium text-amber-800">
            <input type="checkbox" checked={isQuestion}
              onChange={(e) => setIsQuestion(e.target.checked)} />
            This is a question
          </label>
          <Btn kind="primary" className="ml-auto" disabled={busy || !text.trim()} onClick={post}>
            Post
          </Btn>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          The PNS owner and the sales PIC are notified on every post, whether or not you
          tag them. Marking it a question keeps it flagged until somebody closes it.
        </p>
      </div>
    </>
  );
}
