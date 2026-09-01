import { useEffect, useMemo, useState } from "react";
import { api, GENERAL_TITLE, PENDING, groupTone, rp } from "../api";
import { Btn, Card, Head, MultiSelect, Pill, inputCls, useSticky } from "../ui";
import { ProposalActions } from "./Queues";

// Pending & proposals, run by region. Pick the regions in the room, and both people
// lists — the salesperson who sold it and the PNS PIC holding it — narrow to whoever
// actually has deals there. Picking from all of Commercial when three of them cover your
// region is how a list ends up with somebody else's deals in it.

const REGIONS = ["GJ", "WJ", "CJ", "EJ"];

/* A multi-select that reads as a row of toggles rather than a <select multiple>, which
   nobody can operate without being told to hold ctrl. */
function Toggles({ options, value, onChange, empty = "Any" }) {
  const flip = (v) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onChange([])}
        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
          value.length === 0
            ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
        {empty}
      </button>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => flip(o)}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
            value.includes(o)
              ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
              : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

/* Whole days since a YYYY-MM-DD date, or null if it is missing or unparseable — a bad
   date should read as no date, never as NaN on the row. */
function ageDays(iso) {
  if (!iso) return null;
  const then = Date.parse(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

/* One line of the list. `children` is where a proposal's status controls go; a pending
   ticket passes none, because what happens to it happens inside the ticket. */
function Line({ n, t, onOpen, right, children }) {
  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-7 shrink-0 font-mono text-[11px] text-slate-400">{n}.</span>
        {/* Reference and date stacked, so the shipper name still starts near the left
            of the row instead of being pushed along by a date sitting beside it
            (Michael, 2026-08-26). The column is fixed-width so the names line up down
            the list — a ragged left edge is what makes a list like this hard to scan.
            158px holds the widest it can ever be, "raised 2026-08-26 (365d)", without
            wrapping the age onto a third line.

            The date is when the deal was RAISED, not when it last moved: on a review
            list the question behind every row is how long this has been going on.
            Sales CRM's date where the ticket came from the sync, ours where it was
            raised here. */}
        <div className="flex w-[158px] shrink-0 flex-col leading-tight">
          <button onClick={() => onOpen(t.ref)}
            className="text-left font-mono text-[13px] font-bold text-[#EE1B2C] hover:underline">
            {t.ref}
          </button>
          <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-slate-400"
            title="When this was raised">
            raised {t.submitted_on}
            {ageDays(t.submitted_on) != null && (
              <span className={ageDays(t.submitted_on) >= 30 ? " text-amber-600" : ""}>
                {" "}({ageDays(t.submitted_on)}d)
              </span>
            )}
          </span>
        </div>
        <b className="text-[13px]">{t.shipper}</b>
        <Pill dot>{t.status}</Pill>
        {t.group && <Pill tone={groupTone(t.group)}>{t.group}</Pill>}
        <span className="text-[12px] text-slate-500">{t.service} &middot; {rp(t.revenue)}</span>
        <span className="ml-auto text-[12px] text-slate-400">{right}</span>
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

/* A flat numbered list, not grouped under a salesperson heading (Michael, 2026-08-21).
   The name moved onto the row itself, which keeps the information and drops a header
   that chopped the list into blocks nobody was walking separately.

   Defined at module scope, NOT inside the screen: a component declared inside render is
   a different type on every render, so React throws away its subtree and rebuilds it —
   which would wipe whatever somebody had half-typed into a proposal's reason box. */
/* A note added from the row, without opening the ticket (Baskoro, 2026-08-28).
 *
 * This screen is walked ticket by ticket on a call, and the one thing people actually
 * want to do mid-walk is record what was just said. Opening the ticket to do it unmounts
 * the list and loses your place in a walk of forty rows, so most of what gets said never
 * got written down at all.
 *
 * It posts into GENERAL DISCUSSION, the standing thread every ticket has (Michael,
 * 2026-09-01). It used to start a new thread per note, titled from the first few words.
 * That is the right shape for a point somebody has to answer and a wrong one for a
 * weekly status update: a deal walked every week for two months accumulated eight
 * one-post threads, and the running history of what was said about it could only be
 * reconstructed by reading all eight. One standing thread reads as the log it is.
 *
 * It also posts as a plain NOTE rather than a question. A weekly update is not work
 * owed by anybody, and filing every one as a question meant the unanswered count — the
 * number that tells PNS what actually needs an answer — grew by one per deal per week
 * and was never brought back down. Raising something that genuinely needs answering is
 * still a question, asked from the ticket's own Discussion tab where it can be tagged
 * to a person and resolved.
 */
function QuickComment({ t, notify, onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      // No thread_key and no new_thread_title is how the API spells "the general
      // thread" — it stores thread_key NULL. Nothing new had to be built for this:
      // the standing thread has existed since threads were introduced, it just had no
      // name and nothing pointed at it.
      await api.addComment(t.ref, { body, is_question: false });
      setText("");
      setOpen(false);
      notify(`Added to ${GENERAL_TITLE} on ${t.ref}`);
      await onDone?.();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] text-slate-600 hover:border-slate-400">
        + Note
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input className={`${inputCls} min-w-[220px] flex-1`} autoFocus value={text}
        placeholder={`Weekly update on ${t.ref} — posts to ${GENERAL_TITLE}.`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          if (e.key === "Escape") { setOpen(false); setText(""); }
        }} />
      <Btn kind="primary" disabled={busy || !text.trim()} onClick={send}>Post</Btn>
      <Btn onClick={() => { setOpen(false); setText(""); }}>Cancel</Btn>
    </div>
  );
}


function Block({ label, sub, rows, tone, offset, onOpen, actions, notify, onDone }) {
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
        {rows.length === 0 && (
          <p className="text-center text-sm text-slate-400">Nothing here.</p>
        )}
        {rows.map((t, i) => (
          <Line key={t.ref} n={offset + i + 1} t={t} onOpen={onOpen}
            right={`${t.region} · ${t.sales || "no sales PIC"} · PNS ${t.owner || "unassigned"}`}>
            {actions ? actions(t) : null}
            <QuickComment t={t} notify={notify} onDone={onDone} />
          </Line>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------ pending & proposals */
/* One screen for the whole review (Michael, 2026-08-21). A review walks the proposals
   sitting with shippers AND everything still open, so keeping them behind two menu
   entries meant leaving the list to look at the other half and losing your place.

   The two halves are not the same job, and the screen says so: a submitted proposal has
   an outcome to record, so it carries the status controls inline; a pending ticket is
   discussed and updated inside the ticket itself, so it is a link and nothing more. */
export function ReviewMeeting({ me, onOpen, notify }) {
  const [props_, setProps] = useState(null);
  const [pend, setPend] = useState(null);
  // Sticky, like every queue filter: this screen is walked ticket by ticket on a call,
  // and opening one unmounts the list, so the region and the names would otherwise have
  // to be picked again before every single ticket.
  const [regions, setRegions] = useSticky("filter:pending:regions", []);
  // Multi-select dropdowns. Dropdowns because a wrapping row of thirty name pills is
  // what made this bar unreadable; multi-select because a review is run for the people
  // in the room and that is rarely one person.
  const [people, setPeople] = useSticky("filter:pending:sales", []);
  const [owners_, setOwners] = useSticky("filter:pending:owners", []);
  const [err, setErr] = useState(null);

  const load = () => {
    const region = regions.length ? regions : undefined;
    setProps(null); setPend(null);
    Promise.all([
      api.tickets({ status: "Proposal Submitted", region }),
      api.tickets({ status: PENDING, region }),
    ]).then(([a, b]) => { setProps(a.tickets); setPend(b.tickets); })
      .catch((e) => setErr(e.message));
  };
  useEffect(load, [regions.join(",")]);

  const all = [...(props_ || []), ...(pend || [])];

  // Both name lists come from the tickets ALREADY narrowed to the chosen regions, so
  // they answer "who has deals in the room" rather than "who exists". There is no region
  // column on a user, and inventing one would be a second thing to keep in step with
  // reality.
  const sales = useMemo(
    () => [...new Set(all.map((t) => t.sales).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);
  const owners = useMemo(
    () => [...new Set(all.map((t) => t.owner).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);

  // A name picked for one region and then deselected with the region should not keep
  // filtering invisibly. Unassigned survives on purpose — it is not a name that can stop
  // being in the list.
  //
  // GUARDED ON `loaded`, and that guard is the whole feature working or not (Michael,
  // 2026-08-21). Both lists are derived from the tickets, so before the fetch returns
  // they are empty — and this effect runs on mount. Ungated it filtered every restored
  // name against an empty list, cleared the selection, and useSticky then saved that
  // empty value straight over the good one. The filter came back, was wiped a frame
  // later, and looked like it had never been remembered at all.
  const loaded = props_ !== null && pend !== null;
  useEffect(() => {
    if (!loaded) return;
    setPeople((p) => p.filter((x) => sales.includes(x)));
  }, [loaded, sales.join(",")]);
  useEffect(() => {
    if (!loaded) return;
    setOwners((p) => p.filter((x) => x === "__unassigned__" || owners.includes(x)));
  }, [loaded, owners.join(",")]);

  const keep = (list) =>
    (list || []).filter((t) =>
      (!people.length || people.includes(t.sales))
      && (!owners_.length
          || owners_.some((o) => (o === "__unassigned__" ? !t.owner : t.owner === o))));

  const propRows = keep(props_);
  const pendRows = keep(pend);

  return (
    <>
      <Head title="Pending and proposals"
        sub="The whole review on one screen. Proposals first — record the outcome right here. Then everything still open: open the ticket and take it up in its discussion."
        right={<Btn onClick={() => window.print()}>Print list</Btn>} />

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}

      <Card className="mb-4 flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Region
          </span>
          <Toggles options={REGIONS} value={regions} onChange={setRegions} empty="All regions" />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2.5">
            <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              Salesperson
            </span>
            {sales.length === 0 ? (
              <span className="text-[12.5px] text-slate-400">
                {props_ === null ? "Loading…" : "Nobody has a live deal in those regions."}
              </span>
            ) : (
              <MultiSelect label="Salesperson" picked={people}
                onClear={() => setPeople([])}
                sections={[{ label: null, items: sales.map((x) => ({
                  key: x, label: x, on: people.includes(x),
                  toggle: () => setPeople((p) =>
                    p.includes(x) ? p.filter((y) => y !== x) : [...p, x]),
                })) }]} />
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              PNS PIC
            </span>
            <MultiSelect label="PNS PIC" picked={owners_}
              onClear={() => setOwners([])}
              sections={[{ label: null, items: [
                // Unassigned is a real answer here, and the one worth raising out loud.
                { key: "__unassigned__", label: "Unassigned",
                  on: owners_.includes("__unassigned__"),
                  toggle: () => setOwners((p) => p.includes("__unassigned__")
                    ? p.filter((y) => y !== "__unassigned__") : [...p, "__unassigned__"]) },
                ...owners.map((o) => ({
                  key: o, label: o, on: owners_.includes(o),
                  toggle: () => setOwners((p) =>
                    p.includes(o) ? p.filter((y) => y !== o) : [...p, o]),
                })),
              ] }]} />
          </div>
          {(people.length > 0 || owners_.length > 0) && (
            <button onClick={() => { setPeople([]); setOwners([]); }}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px]">
              Clear
            </button>
          )}
        </div>
        {regions.length > 0 && (
          <p className="text-[11.5px] text-slate-400">
            Both lists are narrowed to whoever has a live deal in {regions.join(", ")} —
            not the whole of Commercial or PNS.
          </p>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <Block label="Proposals submitted" sub="Out with the shipper. Record the outcome here."
          rows={propRows} tone="bg-teal-50 text-teal-700" offset={0} onOpen={onOpen}
          actions={(t) => <ProposalActions t={t} me={me} notify={notify} onDone={load} />}
          notify={notify} onDone={load} />
        <Block label="All pending" sub="Still open. Raise a point here, or open the ticket for the full discussion."
          rows={pendRows} tone="bg-amber-50 text-amber-700" offset={propRows.length}
          onOpen={onOpen} notify={notify} onDone={load} />
      </div>
    </>
  );
}
