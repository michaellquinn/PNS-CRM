import { useEffect, useState } from "react";
import { api, groupTone } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

const TITLES = { onboarding: "Go live from Solutioning", readiness: "Ops Readiness", golive: "Go Live",
  direct: "Not submitted yet" };
// The teams that confirm points, in the order a launch meets them. Each gets a tab on
// Ops Readiness (Michael, 2026-11-04).
const TEAM_ORDER = ["2W", "4W", "6W", "Sameday", "Sort", "DE", "CL"];
// Where one team stands on one launch: nothing confirmed, some, or all.
const teamState = (g) => !g ? null : g.done === g.total ? "cleared" : g.done ? "ongoing" : "pending";
const HELP = { onboarding: "Won deals from solutioning, waiting on Sales to fill in and submit the onboarding requirements. Once submitted, a launch moves to Ops Readiness.",
  direct: "Launches raised on this page that Sales have not submitted yet. Open one to finish its onboarding form; once submitted it moves to Ops Readiness.",
  readiness: "Every launch and how far each team has got, nearest go-live first. Pick a team to see what it has finished (Cleared) and what is still open. A launch leaves a team's tab once that team has confirmed everything AND it has gone live, and leaves All once every team has. Each team confirms only its own points.",
  golive: "Upcoming: launches whose go-live date is still coming, nearest first — including won deals whose onboarding form is not in yet. Live: launches whose go-live date has arrived, most recent first. A launch moves from Upcoming to Live on its date; there is nothing to press." };// today or past, amber inside three days, plain after that.
const goLiveTone = (d) => d == null ? "bg-slate-100 text-slate-600"
  : d < 0 ? "bg-rose-100 text-rose-800"
  : d === 0 ? "bg-rose-100 text-rose-800"
  : d <= 3 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700";
const goLiveWords = (d) => d == null ? "no date"
  : d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue`
  : d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`;
// What kind of launch it is (ops meeting, 2026-10-12): the account tier, Must Win when
// the deal carries it, and the service. Standard (BAU) gets no tag (Michael,
// 2026-10-12): it is the ordinary case, so only Hypercare and Strategic are called out.
export function DealTags({ service, acctType, mustWin }) {
  return <>
    {acctType && acctType !== "Standard" && <Pill tone={groupTone(acctType)}>{acctType}</Pill>}
    {mustWin && <Pill tone={groupTone("Must Win")}>Must Win</Pill>}
    {service && <Pill tone="bg-sky-50 text-sky-800">{service}</Pill>}
  </>;
}
const format = (v) => v ? String(v).replace("T", " ").slice(0, 16) + (String(v).length > 10 ? " WIB" : "") : "—";

export function OperationalList({ view = "onboarding", me, onOpen, notify = () => {} }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  // Where each launch stands for the team reading it (Michael, 2026-09-25).
  const [state, setState] = useState("");
  const [query, setQuery] = useState("");
  // Which team's tab is open (Michael, 2026-11-04). A team member starts on their own
  // team; Ops, QC, PNS and Admin start on All.
  const [team, setTeam] = useState(TEAM_ORDER.includes(me?.group) ? me.group : "");
  // Go Live: what is coming, or what has gone live (Michael, 2026-11-04).
  const [when, setWhen] = useState("upcoming");
  const load = () => api.operationalList(view).then(setData).catch(e => setErr(e.message));
  useEffect(() => { setData(null); setErr(""); load(); }, [view]);
  if (err) return <Empty>{err}</Empty>;
  const ready = view === "readiness";
  // On Ops Readiness every launch is read through the open tab: that team's own points
  // on a team tab, the whole launch on All. A team is "done" with a launch once it has
  // confirmed everything and the launch is live -- it then leaves that team's tab.
  const of = (r, t = team) => t ? (r.teams || []).find((g) => g.group === t) : null;
  const stateOf = (r, t = team) => t ? teamState(of(r, t)) : r.readiness_state;
  const onTab = (r, t = team) => !t || (of(r, t) && !(stateOf(r, t) === "cleared" && r.already_live));
  const goLive = view === "golive";
  const isLive = (r) => !!r.already_live;
  const base = (data?.rows || []).filter(r => (!ready || onTab(r))
    && (!goLive || (when === "live" ? isLive(r) : !isLive(r))))
    // Upcoming nearest first; Live most recent first.
    .sort((a, b) => !goLive ? 0 : when === "live"
      ? String(b.actual_golive || b.planned_golive || "").localeCompare(String(a.actual_golive || a.planned_golive || ""))
      : (a.days_to_golive ?? 9999) - (b.days_to_golive ?? 9999));
  const rows = base.filter(r => (!filter || r.status === filter)
    && (!state || stateOf(r) === state)
    && `${r.ref} ${r.opportunity_name} ${r.shipper}`.toLowerCase().includes(query.toLowerCase()));
  const counted = (s) => base.filter(r => stateOf(r) === s).length;
  const teams = TEAM_ORDER.filter((t) => (data?.rows || []).some((r) => of(r, t)));
  const openFor = (t) => (data?.rows || []).filter((r) => onTab(r, t) && stateOf(r, t) !== "cleared").length;
  return <>
    <Head title={TITLES[view]} sub={HELP[view]} right={data && <Pill>{rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}</Pill>} />
    {/* A tab per team (Michael, 2026-11-04), each with how many launches it still has
        open, so every team sees what it has finished and what it has not. */}
    {goLive && <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
      {[["upcoming", "Upcoming"], ["live", "Live"]].map(([w, label]) => (
        <button key={w} type="button" onClick={() => setWhen(w)} aria-pressed={when === w}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${when === w
            ? "border-[#EE1B2C] font-semibold text-[#EE1B2C]" : "border-transparent text-slate-600 hover:text-slate-800"}`}>
          {label}
          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[11px] font-bold text-slate-600">
            {(data?.rows || []).filter((r) => (w === "live") === isLive(r)).length}
          </span>
        </button>
      ))}
    </div>}
    {ready && <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
      {[["", "All teams"], ...teams.map((t) => [t, t])].map(([t, label]) => (
        <button key={t || "all"} type="button" onClick={() => { setTeam(t); setState(""); }} aria-pressed={team === t}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${team === t
            ? "border-[#EE1B2C] font-semibold text-[#EE1B2C]" : "border-transparent text-slate-600 hover:text-slate-800"}`}>
          {label}
          {t && <span className={`ml-1.5 rounded-full px-1.5 text-[11px] font-bold ${openFor(t)
            ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{openFor(t) || "✓"}</span>}
        </button>
      ))}
    </div>}
    <div className="mb-4 flex flex-wrap gap-2">
      <input className={`${inputCls} max-w-sm`} placeholder="Search opportunity or shipper" value={query} onChange={e => setQuery(e.target.value)} />
      {/* Status filter removed: Go live from Solutioning lists one status only. */}
      {ready && <div className="flex flex-wrap gap-1">
        {[["", "All"], ["pending", "Pending"], ["ongoing", "Ongoing"], ["cleared", "Cleared"]].map(([v, label]) => (
          <button key={v} type="button" onClick={() => setState(v)} aria-pressed={state === v}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ${
              state === v ? "bg-[#EE1B2C] text-white" : "border border-slate-300 text-slate-600"}`}>
            {label}{v ? ` (${counted(v)})` : ` (${base.length})`}
          </button>
        ))}
      </div>}
    </div>
    {!data ? <p>Loading…</p> : !rows.length ? <Empty>{goLive
      ? (when === "live" ? "Nothing has gone live yet." : "Nothing is scheduled to go live.")
      : "No opportunities waiting here."}</Empty> : <div className="space-y-3">
      {rows.map(r => <Card key={r.ref} className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="font-mono font-semibold text-[#EE1B2C] hover:underline" onClick={() => onOpen(r.ref)}>{r.ref}</button>
          {/* Ops Readiness carries two tags and no more (Michael, 2026-09-28): how far
              the team has got, and when it goes live. The go-live pill already says
              "today" or "overdue", so status, "already live" and "confirmation overdue"
              only repeated it. The other screens keep their status. */}
          {!ready && !goLive && <Pill>{r.status}</Pill>}
          {/* Go Live: when, and for what is coming, whether the teams are ready. */}
          {goLive && (isLive(r)
            ? <Pill tone="bg-emerald-100 text-emerald-800">Live since {r.actual_golive || r.planned_golive || "—"}</Pill>
            : <Pill tone={goLiveTone(r.days_to_golive)}>Go live {r.planned_golive || "—"} · {goLiveWords(r.days_to_golive)}</Pill>)}
          {goLive && !isLive(r) && !r.submitted && <Pill tone="bg-amber-100 text-amber-800">Form not submitted</Pill>}
          {goLive && r.submitted && r.points_total > 0 && (
            <Pill tone={r.points_done === r.points_total ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
              {r.points_done}/{r.points_total} confirmed
            </Pill>
          )}
          {/* Which way it came in (Michael, 2026-10-05). Only the newer route is
              tagged; a launch from solutioning is the ordinary case. */}
          {r.source === "New onboarding" && view !== "direct" && (
            <Pill tone="bg-violet-50 text-violet-700">New onboarding</Pill>
          )}
          <DealTags service={r.service} acctType={r.acct_type} mustWin={r.must_win} />
          {!ready && r.overdue && <Pill tone="bg-rose-100 text-rose-800">Confirmation overdue</Pill>}
          {ready && r.points_total > 0 && (() => {
            // The open tab's own count: this team's points, or the whole launch on All.
            const g = of(r);
            const done = g ? g.done : r.points_done, total = g ? g.total : r.points_total;
            const st = stateOf(r);
            return <Pill tone={st === "cleared" ? "bg-emerald-100 text-emerald-800"
              : st === "ongoing" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}>
              {team ? `${team} ` : ""}{done}/{total} confirmed
            </Pill>;
          })()}
          {ready && (
            <Pill tone={goLiveTone(r.days_to_golive)}>
              Go live {r.planned_golive || "—"} · {goLiveWords(r.days_to_golive)}
            </Pill>
          )}
          {/* D-2 (2026-10-12): when Sales should have it in. A reminder, never a block. */}
          {r.submit_by && (
            <Pill tone={goLiveTone(r.days_to_submit_by)}>
              Submit by {r.submit_by} · {r.days_to_submit_by < 0
                ? `${-r.days_to_submit_by} day${r.days_to_submit_by === -1 ? "" : "s"} late`
                : r.days_to_submit_by === 0 ? "today" : `in ${r.days_to_submit_by} day${r.days_to_submit_by === 1 ? "" : "s"}`}
            </Pill>
          )}
          <Btn className="ml-auto" onClick={() => onOpen(r.ref)}>Open onboarding</Btn>

        </div>
        <h3 className="mt-2 text-[15px] font-semibold">{r.opportunity_name}</h3>
        <p className="mt-1 text-[12px] text-slate-500">CRM {r.opportunity_id || "—"} · {r.shipper} · {r.service} · Sales {r.sales || "unassigned"}</p>
        <div className="mt-2 flex flex-wrap gap-x-6 text-[12px] text-slate-600">
          <span>First pickup: {format(r.pickup_at)}</span>
          {r.deadline && <span>Confirm by: {format(r.deadline)} (always before pickup)</span>}
          {r.actual_golive && <span>Actual go-live: {r.actual_golive}</span>}
        </div>
        {/* Every team's progress on this launch, the open tab's team ringed. */}
        {ready && !!r.teams?.length && <div className="mt-2 flex flex-wrap gap-1.5">
          {r.teams.map((g) => <span key={g.group} className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${
            g.done === g.total ? "bg-emerald-100 text-emerald-800"
              : g.done ? "bg-amber-100 text-amber-800" : "bg-rose-50 text-rose-700"}${
            g.group === team ? " ring-2 ring-[#EE1B2C] ring-offset-1" : ""}`}>
            {g.group} {g.done}/{g.total}
          </span>)}
        </div>}
        {!ready && !!r.pending.length && <p className="mt-2 text-[12px] text-amber-800">Outstanding: {r.pending.join(" · ")}</p>}
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

// One point of a readiness card: confirmed on its own, or handed to another team with
// a note that says why it is theirs (Michael, 2026-09-25).
function CheckItem({ it, me, frozen, run, teams }) {
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const mine = !frozen && (me.group === it.owner_group || me.group === "Admin");
  const done = it.status === "confirmed";
  const act = (body) => run(() => api.operationalItem(it.id, { fingerprint: it.fingerprint, ...body }),
    body.action === "move" ? `Handed to ${body.to_group}` : "Point confirmed", true);
  // ONE LINE per task (Michael, 2026-09-25): the tick, the task, then its controls on
  // the same row. The stacked version turned seven tasks into a page of scrolling, and
  // a team reading its own card could not see the whole list at once.
  const field = "h-8 rounded-lg border border-slate-300 px-2 text-[12.5px]";
  return <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-1 py-1.5 last:border-b-0 ${done ? "bg-emerald-50/40" : ""}`}>
    <span className={`text-[12.5px] ${done ? "text-emerald-700" : "text-slate-300"}`}>{done ? "✓" : "○"}</span>
    <span className="min-w-[180px] flex-1 truncate text-[12.5px]" title={it.label}>{it.label}</span>
    {it.owner_group !== it.origin_group && (
      <span className="shrink-0 text-[11px] text-sky-700" title={it.moved_note || ""}>from {it.origin_group}</span>
    )}
    {done ? (
      <>
        <span className="shrink-0 text-[11px] text-slate-500">
          {it.confirmed_name}{it.note ? ` · ${it.note}` : ""}
        </span>
        {mine && <button type="button" className="shrink-0 text-[11px] text-slate-400 underline"
          onClick={() => {
            const why = window.prompt("What changed? This reopens the point for your team.");
            if (why && why.trim()) act({ action: "reopen", note: why.trim() });
          }}>reopen</button>}
      </>
    ) : mine ? (
      <>
        <input className={`${field} w-[150px] shrink-0`} placeholder="Note"
          value={note} onChange={e => setNote(e.target.value)} />
        <button type="button" onClick={() => act({ action: "confirm", note })}
          className="h-8 shrink-0 rounded-lg bg-[#EE1B2C] px-3 text-[12.5px] font-medium text-white">
          Confirm
        </button>
        <select className={`${field} w-[110px] shrink-0`} value={to}
          onChange={e => setTo(e.target.value)}>
          <option value="">Hand to…</option>
          {teams.filter(g => g !== it.owner_group).map(g => <option key={g}>{g}</option>)}
        </select>
        <button type="button" disabled={!to || !note.trim()}
          title={to && !note.trim() ? "A note is required to hand a point over" : ""}
          onClick={() => act({ action: "move", to_group: to, note })}
          className="h-8 shrink-0 rounded-lg border border-slate-300 px-3 text-[12.5px] disabled:opacity-40">
          Hand over
        </button>
      </>
    ) : (
      <span className="shrink-0 text-[11px] text-slate-400">{it.owner_group} confirms</span>
    )}
  </div>;
}

function Check({ c, items, me, canEdit, frozen, run, teams }) {
  const [reason, setReason] = useState("");
  const [workaround, setWorkaround] = useState("");
  // Admin may act for any team (Michael, 2026-09-18); the server records it as such.
  const own = !frozen && (me.group === c.owner_group || me.group === "Admin");
  const mine = items.filter(i => i.check_key === c.check_key);
  const done = mine.filter(i => i.status === "confirmed").length;
  const act = (body) => run(() => api.operationalDecision(c.id, { fingerprint: c.fingerprint, ...body }), "Readiness decision recorded");
  return <div className="rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap items-center gap-2"><b className="text-[13px]">{c.label}</b><Pill>{c.owner_group}</Pill>
      <Pill tone={c.approved_at ? "bg-orange-100 text-orange-800" : c.status === "ready" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
        {c.approved_at ? "Approved with exception" : c.status.replaceAll("_", " ")}
      </Pill>
    </div>
    {!!mine.length && <p className="mt-1 text-[11px] text-slate-500">
      {done}/{mine.length} confirmed{own ? "" : " · another team confirms these"}
    </p>}
    {c.note && <p className="mt-2 whitespace-pre-wrap text-[13px]">{c.note}</p>}
    {/* The card is ready when its points are; there is no whole-card button any more
        (Michael, 2026-09-25). Everyone sees every point, and confirms only their own. */}
    <div className="mt-2 rounded-lg border border-slate-200">
      {mine.map(it => <CheckItem key={`${it.id}-${it.fingerprint}`} it={it} me={me}
        frozen={frozen} run={run} teams={teams} />)}
      {!mine.length && <p className="p-2 text-[12px] text-slate-500">No points on this card.</p>}
    </div>
    {/* "Request an exception" removed from the card (Michael, 2026-09-25): readiness is
        settled point by point, and a point that cannot be met is handed to the team that
        can meet it. Any exception already recorded still shows below. */}
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

/* The Onboarding thread (Michael, 2026-10-12): Sales, PNS and the ops teams talk about a
   launch in one place, on the launch itself. It is the "Onboarding" thread of the
   ticket's discussion; ops accounts see this thread and no other. */
function OnboardingDiscussion({ ticketRef, me, notify }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.onboardingDiscussion(ticketRef)
    .then((d) => { setRows(d.comments); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [ticketRef]);
  const post = async () => {
    setBusy(true);
    try { await api.postOnboardingDiscussion(ticketRef, text.trim()); setText(""); await load(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  const mayPost = !["Visitor", "Finance"].includes(me.group);
  return <section className="mb-5 rounded-xl border border-slate-200 p-4">
    <h3 className="mb-1 font-semibold">Discussion · Onboarding</h3>
    <p className="mb-3 text-[12px] text-slate-500">For Sales, PNS and the ops teams on this launch. A post tells the deal's people and every team with points here.</p>
    {err && <p className="text-[12.5px] text-rose-700">{err}</p>}
    {!err && rows === null && <p className="text-[12.5px] text-slate-400">Loading…</p>}
    {rows && rows.length === 0 && <p className="text-[12.5px] text-slate-400">Nothing said yet.</p>}
    {rows && rows.length > 0 && <div className="mb-3 flex flex-col gap-2">
      {rows.map((c) => <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
        <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[12px]">
          <b>{c.author}</b><span className="text-slate-400">{c.group}</span>
          <span className="font-mono text-[10.5px] text-slate-400">{format(c.at)}</span>
          {c.edited_at && <span className="text-[10.5px] italic text-slate-400">edited</span>}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] text-slate-700">{c.body}</p>
      </div>)}
    </div>}
    {mayPost && <div className="flex flex-col gap-2">
      <textarea className={`${inputCls} min-h-[70px]`} value={text} placeholder="Write to Sales, PNS and the teams on this launch…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); post(); } }} />
      <div className="flex items-center gap-2">
        <Btn kind="primary" disabled={busy || !text.trim()} onClick={post}>Post</Btn>
        <span className="text-[11px] text-slate-400">Ctrl+Enter posts</span>
      </div>
    </div>}
  </section>;
}

export function OnboardingPane({ ticketRef, me, notify }) {
  const [data, setData] = useState(null);
  const [p, setP] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
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
  // A No switch sets its quantity to 0; switching back to Yes clears it for a real
  // number (Michael, 2026-09-17). The server does the same, so the page cannot disagree.
  const COUNT_OF = { pickup_tkbm: "pickup_tkbm_count", delivery_tkbm: "delivery_tkbm_count", implan: "implan_count" };
  const SWITCH_OF = Object.fromEntries(Object.entries(COUNT_OF).map(([s, c]) => [c, s]));
  const set = (key, value) => setP(prev => {
    const next = { ...prev, [key]: value };
    if (COUNT_OF[key]) next[COUNT_OF[key]] = value === "No" ? "0" : prev[COUNT_OF[key]] === "0" ? "" : prev[COUNT_OF[key]];
    return next;
  });
  const HOURS = Array.from({ length: 25 }, (_, h) => String(h).padStart(2, "0"));
  const save = (submit) => run(() => api.operationalSave(ticketRef, { payload: p, revision: data.revision, submit, documents_reviewed: reviewed }), submit ? "Submitted · operational database updated · team confirmations requested" : "Draft saved");
  const upload = (kind, file) => {
    if (!file) return;
    const form = new FormData(); form.append("file", file); form.append("kind", kind);
    run(() => api.operationalUpload(ticketRef, form), "Operational document uploaded", true);
  };
  return <div className={busy ? "pointer-events-none opacity-70" : ""}>
    <div className="mb-4 rounded-xl bg-sky-50 p-4">
      <div className="flex flex-wrap gap-2"><DealTags service={data.service} acctType={data.acct_type} mustWin={data.must_win} /><Pill>{data.status}</Pill><Pill>Revision {data.revision}</Pill>{data.submitted_at && <Pill>Database synced on submission</Pill>}</div>
      <p className="mt-2 text-[12px] text-slate-600">Sales aim to submit by D-2 before go-live, so the teams have time to confirm — the app reminds them, it does not block. The last possible submit is D-1 20:00 WIB before the first pickup. Teams confirm the same day or next day 20:00 maximum, always before pickup. Onboarding does not change pricing, status, ownership or ticket approval routing.</p>
      {data.submitted_at && <p className="mt-1 text-[12px]">Requirements submitted: {format(data.submitted_at)}</p>}
      {!data.eligible && <p className="mt-2 font-medium text-amber-800">Input is available when the opportunity is Ready to Ship.</p>}
    </div>
    <h3 className="mb-3 font-semibold">Sales requirements</h3>
    <p className="mb-4 text-[12px] text-slate-500">Inputs marked * are needed to submit; the treatment details, handling request and driver requirements are optional. Manpower No requires quantity 0. Greyed answers come from the Project Charter and are not retyped here — correct them on the ticket’s Project Charter tab and they follow. Product type, shipment mode, MPS, RDO and shipment frequency always follow the charter: if one is blank, fill it there first.</p>
    {[...new Set(data.fields.map(f => f.section))].map(section => <section key={section} className="mb-5">
      <h4 className="mb-3 border-b pb-2 text-[13px] font-semibold text-slate-700">{section}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        {data.fields.filter(f => f.section === section).map(f => { const Field = f.type === "packing" ? "div" : "label";
          /* Answers the Project Charter already holds are shown, not asked for again
             (Michael, 2026-09-14). Two boxes for one answer gets two answers, and then
             nobody can say which one Ops built the launch against. Correct it on the
             ticket's Project Charter tab and this follows.

             The server decides which keys these are and only locks one the charter can
             actually fill -- the form refuses to submit while any input is blank, so a
             locked empty field would be a dead end with no way forward. */
          const fixed = (data.locked || []).includes(f.key);
          const autoZero = SWITCH_OF[f.key] && p[SWITCH_OF[f.key]] === "No";
          const off = !editable || fixed || autoZero;
          // Split on the dash even when only one side is picked yet, or choosing "From" first
          // would blank both boxes. A pre-range "10:00" has no dash and shows empty.
          const [hFrom = "", hTo = ""] = String(p[f.key] || "").includes("-") ? String(p[f.key]).split("-") : [];
          return <Field key={f.key} className={f.type === "textarea" || f.type === "packing" ? "md:col-span-2" : ""}>
          <span className="mb-1 block text-[12px] text-slate-600">
            {f.label} {fixed
              ? <span className={`font-normal ${f.follows_charter && !p[f.key] ? "text-amber-700" : "text-slate-400"}`}>
                  · {f.follows_charter && !p[f.key] ? "blank — fill it on the Project Charter" : "from the Project Charter"}</span>
              : f.required ? "*" : <span className="font-normal text-slate-400">· optional</span>}
          </span>
          {f.type === "packing" ? <div className="flex flex-wrap gap-3 rounded-lg border p-3">{f.options.map(tag => <label key={tag} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" disabled={off} checked={(p.packing || []).includes(tag)} onChange={e => {
              const tags = p.packing || [];
              set("packing", e.target.checked ? tag === "No" ? ["No"] : [...tags.filter(t => t !== "No"), tag] : tags.filter(t => t !== tag));
            }} />{tag} · {data.packing_labels[tag]}
          </label>)}</div> : f.type === "select" ? <select className={inputCls} disabled={off} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)}>
            <option value="">Choose…</option>{f.options.map(v => <option key={v}>{v}</option>)}
          </select> : f.type === "hour_range" ? <div className="flex items-center gap-2">
            <select className={inputCls} disabled={off} value={hFrom} onChange={e => set(f.key, `${e.target.value}-${hTo || ""}`)}>
              <option value="">From</option>{HOURS.slice(0, 24).map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <span className="text-slate-400">to</span>
            <select className={inputCls} disabled={off} value={hTo} onChange={e => set(f.key, `${hFrom || ""}-${e.target.value}`)}>
              <option value="">To</option>{HOURS.slice(1).map(h => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div> : f.type === "textarea" ? <textarea className={`${inputCls} min-h-[76px]`} disabled={off} value={p[f.key] || ""} onChange={e => set(f.key, e.target.value)} /> :
          <input className={inputCls} type={f.type} step={f.type === "number" ? "any" : undefined} disabled={off || ["opportunity_id", "service"].includes(f.key)} value={p[f.key] ?? ""} onChange={e => set(f.key, e.target.value)} />}
        </Field>; })}
      </div>
    </section>)}
    <section className="mb-5 rounded-xl border p-4">
      <h4 className="mb-2 font-semibold text-[13px]">Operational uploads</h4>
      <p className="mb-3 text-[12px] text-slate-500">Optional. The product photo Sales attached to the ticket is used here; upload one only if there is none. Only operational material — no pricing/revenue or commercial documents (5 MB per file).</p>
      {/* Photos attached to the ticket itself (Michael, 2026-09-17), so Sales does not
          upload the same picture twice. "All pickup points" is gone. */}
      {!!(data.charter_photos || []).length && <div className="mb-3">
        <b className="text-[12px]">Product photo from the ticket</b>
        {data.charter_photos.map(ph => <a key={ph.id} className="ml-3 text-[12px] text-sky-700 underline" href={`/api/onboarding-v2/tickets/${ticketRef}/charter-photos/${ph.id}`} target="_blank" rel="noreferrer">{ph.filename}</a>)}
      </div>}
      {[['product_photo', (data.charter_photos || []).length ? 'Another product photo' : 'Product photo']].map(([kind,label]) => <div key={kind} className="mb-3">
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
      <div className="space-y-3">{data.checks.map(c => <Check key={`${c.id}-${c.fingerprint}`} c={c}
        items={data.items || []} me={me} frozen={!!data.actual_golive}
        canEdit={data.can_edit && !data.actual_golive} run={run} teams={data.teams || []} />)}</div>
      <p className="mt-3 text-[12px] text-slate-500">Each card is confirmed point by point, and only by the team that holds the point. A point that is not yours can be handed to the right team with a note; it then leaves your count and joins theirs. Only the assigned team can confirm. Sales Managers approve exceptions after the team's feasible workaround confirmation. Assign team accounts under Users & roles.</p>
    </section>}
    {/* "Actual go-live and QC handover" removed (Michael, 2026-09-18). */}
    {/* Ops accounts only reach a launch once Sales have submitted it, so the thread is
        shown to them from then on; Sales and PNS have it from the start. */}
    {/* Ops accounts have the thread on its own Discussion tab at the top of the page;
        Sales and PNS keep it here, on the ticket's Onboarding tab. */}
    {!me.permissions.operationalOnly && <OnboardingDiscussion ticketRef={ticketRef} me={me} notify={notify} />}
    <details className="text-[12px]"><summary className="cursor-pointer font-semibold">Operational history</summary>{data.events.map((e,n) => <div key={n} className="border-b py-2"><span className="text-slate-500">{format(e.at)} · {e.actor}</span><p className="whitespace-pre-wrap break-words">{e.body}</p></div>)}</details>
  </div>;
}

export function OperationalTicket({ ticketRef, me, notify, onBack }) {
  // Two tabs at the top (Michael, 2026-10-12): the launch, and its Onboarding
  // discussion -- next to each other rather than the thread at the foot of a long form.
  const [tab, setTab] = useState("onboarding");
  const tabs = [["onboarding", "Onboarding"], ["discussion", "Discussion"]];
  return <><Head title={`Opportunity ${ticketRef}`} sub="Operational view · commercial tabs and attachments are restricted" right={<Btn onClick={onBack}>Back</Btn>} />
    <Card>
      <div className="flex gap-1 border-b border-slate-200 px-2">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`border-b-2 px-3 py-2.5 text-[13px] ${tab === k
              ? "border-[#EE1B2C] font-semibold text-[#EE1B2C]" : "border-transparent text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === "onboarding"
          ? <OnboardingPane ticketRef={ticketRef} me={me} notify={notify} />
          : <OnboardingDiscussion ticketRef={ticketRef} me={me} notify={notify} />}
      </div>
    </Card></>;
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
  return <><Head title="Operational Database" sub="Reusable opportunity-level records. Automatically updated after Sales submits. No pricing or revenue."
      right={<a href="/api/operational-master/export.xlsx"><Btn>Export to Excel</Btn></a>} />
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
