import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Dashboard from "./screens/Dashboard";
import Matrix from "./screens/Matrix";
import Capa from "./screens/Capa";
import Users from "./screens/Users";
import TicketDetail from "./screens/TicketDetail";
import Workload from "./screens/Workload";
import Mine from "./screens/Mine";
import Sync from "./screens/Sync";
import Changelog from "./screens/Changelog";
import Guide from "./screens/Guide";
import { Onboarding, ToHandOver } from "./screens/Onboarding";
import { NewRequest, NewCapa } from "./screens/Forms";
import Accounts from "./screens/Accounts";
import Ignored from "./screens/Ignored";
import Rdo from "./screens/Rdo";
import { ReviewMeeting, WeeklyMeeting } from "./screens/Meetings";
import StatusFlow from "./screens/StatusFlow";
import DataChecks from "./screens/DataChecks";
import {
  AwaitingPrice, Open, PendingCrmId, ToReview, HeadReview, PspPending, ExecSignoff,
  Proposals, ReadyToShip, RecycleBin, Watched,
} from "./screens/Queues";

// One nav entry per screen. `when` reads the permission map the backend sends, so the
// sidebar and the API agree on who may do what — there is no second rule set here.

// Visitor, Finance, Sales Planning and Ops consume the pipeline rather than working
// it. Every ticket queue is visible to everyone (Baskoro's call, 2026-08-11: anyone may
// view active, pending and closed tickets); what stays gated per role is the buttons
// inside each screen, and the backend refuses the action anyway. `works` now only hides
// the working screens that make no sense read-only (My requests, Review meeting).
const READ_ONLY = ["Visitor", "Finance", "Sales Planning", "Ops"];
const works = (m) => !READ_ONLY.includes(m.group);

// The PSP screens live inside Solutioning — PSP approval is a step of solutioning, not
// a separate pipeline — but keep their tag so it is obvious which entries are PSP's.
const NAV = [
  ["Solutioning", [
    { id: "dashboard", label: "Dashboard", icon: "▤", keywords: "overview home stats" },
    { id: "mine", label: "My requests", icon: "◐", when: works, keywords: "my tickets assignment" },
    { id: "new", label: "New request", icon: "＋", when: (m) => m.permissions.createTicket },
    { id: "open", label: "Open", icon: "○", count: "Open",
      keywords: "open ready unclaimed available not started" },
    { id: "crmid", label: "Pending CRM ID", icon: "⚠", count: "Pending CRM ID",
      keywords: "crm id missing blocked salesforce opportunity" },
    { id: "awaiting", label: "Awaiting price", icon: "◷", count: "awaiting", keywords: "pricing" },
    { id: "review", label: "Review - Head PNS", icon: "◎", count: "Pending Review - Head PNS",
      keywords: "pns view pns review" },
    // Named for the head who actually owes it — "Need review" told nobody whose it was.
    { id: "head", label: "Review - Head Sales", icon: "⚑", count: "Pending Review - Head Sales",
      keywords: "sales view head review below bottom floor" },
    { id: "psp-pending", label: "Review - PSP", icon: "✓", count: "Pending Review - PSP",
      tag: "PSP", keywords: "psp pending margin approval decided finished history" },
    { id: "signoff", label: "Review - C-level", icon: "★", count: "Pending Review - C-level",
      keywords: "executive exec sign-off alex dhinesh cso coo" },
    { id: "proposals", label: "Proposal submitted", icon: "◫", count: "Proposal Submitted" },
    { id: "ship", label: "Ready to ship", icon: "➔", count: "Proposal Accepted / Ready to Ship" },
    { id: "meeting", label: "Review meeting", icon: "☷", when: works,
      keywords: "agenda sales region salesperson walk the list" },
    // The PNS side of the same habit. Separate screen rather than a mode, because it
    // answers a different question: the Review meeting is run by region for Sales,
    // this one is run by watched group for PNS.
    { id: "weekly", label: "Weekly meeting", icon: "☶", when: works,
      keywords: "pns agenda pending group owner queue standup" },
    // A ticket is per opportunity; an account normally runs several at once. Without
    // this the flat queues make one shipper look like four, which is what "why are
    // there duplicates?" turned out to mean most of the time.
    { id: "accounts", label: "Accounts", icon: "🏢",
      keywords: "account group shipper parent grouped duplicates opportunities" },
    { id: "workload", label: "Workload", icon: "◴", when: (m) => m.permissions.seeWorkload,
      keywords: "pns capacity assignment load who is free" },
    { id: "sync", label: "Sales CRM sync", icon: "⇄", when: (m) => m.permissions.syncSalesCrm },
  ]],
  // The three watched groups, as their own section rather than three more entries in a
  // fifteen-line Solutioning list. Every rule in the app keys off this distinction, and
  // these are the deals somebody is asked about by name in a meeting — hunting for them
  // across nine status queues was the wrong way round. The same three are also toggles
  // on every queue's filter bar, for narrowing a list you are already reading.
  ["Watched", [
    { id: "g-hypercare", label: "Hypercare", icon: "◆", count: "g:Hypercare",
      keywords: "watched group account tier managed" },
    { id: "g-strategic", label: "Strategic", icon: "◆", count: "g:Strategic",
      keywords: "watched group account tier managed" },
    { id: "g-mustwin", label: "Must Win", icon: "★", count: "g:Must Win",
      keywords: "watched group must win lead source detail opportunity deal" },
  ]],
  // Onboarding is deliberately its own section, not a step inside Solutioning:
  // solutioning ends when the shipper accepts, and what follows asks a different
  // question of different people. Ops read it; Sales complete it.
  ["Onboarding", [
    { id: "handover", label: "To hand over", icon: "⇥",
      keywords: "shipper id go live missing onboarding handover" },
    { id: "onboarding", label: "Onboarding", icon: "◉",
      keywords: "go live ops kick off onboarding schedule" },
  ]],
  ["CAPA", [
    { id: "capa-all", label: "All CAPA", icon: "▤", when: works },
    { id: "capa-new", label: "New", icon: "◷",
      when: (m) => ["PNS", "QC", "Admin"].includes(m.group) },
    { id: "capa-submitted", label: "Submitted", icon: "◫", when: works },
    { id: "capa-closed", label: "Closed", icon: "✓", when: works },
    { id: "capa-raise", label: "Raise CAPA", icon: "＋", when: (m) => m.permissions.capaRaise },
  ]],
  ["Reference", [
    // First in Reference on purpose: it is the entry point for anyone who does not yet
    // know which of the other screens they need.
    { id: "guide", label: "How do I…", icon: "?",
      keywords: "guide help how to flow steps explain onboarding tutorial" },
    { id: "matrix", label: "Routing & limits", icon: "☰" },
    { id: "rdo", label: "RDO", icon: "◱",
      keywords: "rdo customization lever return delivery order which deals" },
    { id: "statusflow", label: "Status flow", icon: "⇉",
      keywords: "status move trigger transition stuck what next why" },
    { id: "checks", label: "Data checks", icon: "⚕",
      when: (m) => m.permissions.editInput,
      keywords: "duplicate duplicates orphan data quality" },
    { id: "changelog", label: "What changed", icon: "🗒" },
  ]],
  ["Administration", [
    { id: "users", label: "Users & roles", icon: "👤", when: (m) => m.permissions.manageUsers },
    { id: "bin", label: "Recycle bin", icon: "♲", when: (m) => m.permissions.deleteTicket },
    // Out of Solutioning on purpose: it makes deals silently not appear.
    { id: "ignored", label: "Sync ignore list", icon: "⊘",
      when: (m) => m.permissions.manageIgnored,
      keywords: "whitelist blacklist skip test junk opportunity never import" },
  ]],
];

// What ?screen= is allowed to name. "detail" is deliberately absent: it is useless
// without a ticket, and ?ticket= already covers that link.
const NAV_IDS = new Set(NAV.flatMap(([, items]) => items.map((i) => i.id)));

// The header search reaches everything: tickets by ref, shipper or opportunity id
// (the server already matches all three), and every screen this person may open —
// so typing "psp" or "sales" jumps straight to that view. "/" focuses it from anywhere.
function GlobalSearch({ me, onOpenTicket, onGo }) {
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const screens = NAV.flatMap(([group, items]) =>
    items.filter((i) => !i.when || i.when(me)).map((i) => ({ ...i, group })));

  const needle = q.trim().toLowerCase();
  const screenHits = needle
    ? screens.filter((s) =>
        `${s.label} ${s.group} ${s.keywords || ""}`.toLowerCase().includes(needle)).slice(0, 5)
    : [];

  useEffect(() => {
    if (needle.length < 2) { setTickets([]); return; }
    const t = setTimeout(() => {
      api.tickets({ search: needle })
        .then((d) => setTickets(d.tickets.slice(0, 8)))
        .catch(() => setTickets([]));
    }, 250);
    return () => clearTimeout(t);
  }, [needle]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = [
    ...screenHits.map((s) => ({ kind: "screen", key: `s-${s.id}`, s })),
    ...tickets.map((t) => ({ kind: "ticket", key: `t-${t.ref}`, t })),
  ];

  const pick = (h) => {
    if (!h) return;
    if (h.kind === "screen") onGo(h.s.id);
    else onOpenTicket(h.t.ref);
    setQ(""); setOpen(false); setHi(0);
  };

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <input
        id="global-search"
        type="search"
        value={q}
        placeholder="Search tickets, shippers, menus…  ( / )"
        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-[13px] focus:border-slate-400 focus:bg-white focus:outline-none"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((n) => Math.min(n + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setHi((n) => Math.max(n - 1, 0)); }
          if (e.key === "Enter") pick(hits[hi] || hits[0]);
          if (e.key === "Escape") { setOpen(false); e.target.blur(); }
        }}
      />
      {open && needle && hits.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {screenHits.length > 0 && (
            <div className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Open a view
            </div>
          )}
          {hits.map((h, idx) => (
            <button
              key={h.key}
              onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              onMouseEnter={() => setHi(idx)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                idx === hi ? "bg-rose-50" : ""}`}>
              {h.kind === "screen" ? (
                <>
                  <span className="w-4 shrink-0 text-center opacity-60">{h.s.icon}</span>
                  <span className="font-medium">{h.s.label}</span>
                  {h.s.tag && (
                    <span className="rounded bg-amber-100 px-1 text-[9.5px] font-bold uppercase text-amber-700">
                      {h.s.tag}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">{h.s.group}</span>
                </>
              ) : (
                <>
                  <span className="shrink-0 font-mono text-[12px] font-bold text-[#EE1B2C]">{h.t.ref}</span>
                  <span className="truncate font-medium">{h.t.shipper}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400">{h.t.status}</span>
                </>
              )}
            </button>
          ))}
          {hits.length === screenHits.length && needle.length >= 2 && tickets.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-slate-400">No tickets match “{q.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Bell({ notes, onRead }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(null);

  useEffect(() => { if (open && !prefs) api.prefs().then(setPrefs).catch(() => {}); }, [open]);

  const toggle = async () => {
    const next = !prefs.email_optout;
    setPrefs({ ...prefs, email_optout: next });
    try { await api.setPrefs({ email_optout: next }); }
    catch { setPrefs({ ...prefs, email_optout: !next }); }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium">
        Notifications{" "}
        <span className={`ml-1 rounded-full px-1.5 text-[11px] ${
          notes.unread ? "bg-[#EE1B2C] text-white" : "bg-slate-100 text-slate-500"}`}>
          {notes.unread}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-[60vh] w-96 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <b className="text-sm">Notifications</b>
            <button className="text-xs text-slate-500 hover:text-slate-900" onClick={onRead}>
              Mark all read
            </button>
          </div>
          {notes.notes.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">Nothing new for you.</p>
          )}
          {notes.notes.map((n) => (
            <div key={n.id} className={`border-b border-slate-100 px-4 py-3 ${n.unread ? "bg-rose-50/40" : ""}`}>
              <p className="text-[13px] leading-snug">{n.body}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {n.at}{n.ticket_ref ? ` · ${n.ticket_ref}` : ""}
              </p>
            </div>
          ))}

          {prefs?.email_configured && (
            <label className="sticky bottom-0 flex items-start gap-2.5 border-t border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={!prefs.email_optout} onChange={toggle} />
              <span>
                <b>Also email me</b> when something needs me
                <span className="block text-[11px] text-slate-500">
                  Assigned, tagged, sent back. Broadcast updates stay here only.
                </span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [ticketRef, setTicketRef] = useState(null);
  const [notes, setNotes] = useState({ notes: [], unread: 0 });
  const [counts, setCounts] = useState({});
  const [toast, setToast] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [tick, setTick] = useState(0);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTick((n) => n + 1);
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch((e) => setErr(e.message));
    // Emails link to /?ticket=SOF-1234, people link to each other with /?screen=awaiting.
    // The app has no router, so read the entry point once, before the sync effect below
    // starts writing to the URL. A ticket wins: it is the more specific destination.
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("ticket");
    const wantedScreen = params.get("screen");
    if (wanted) {
      setTicketRef(wanted);
      setScreen("detail");
    } else if (NAV_IDS.has(wantedScreen)) {
      setScreen(wantedScreen);
    }
  }, []);

  // Keep the URL on the current screen so any view can be sent to a colleague.
  // replaceState, not pushState: the app has no history to walk back through, and Back
  // should leave the app rather than replay screens.
  useEffect(() => {
    const q = screen === "detail" && ticketRef
      ? `?ticket=${encodeURIComponent(ticketRef)}`
      : `?screen=${encodeURIComponent(screen)}`;
    window.history.replaceState({}, "", window.location.pathname + q);
  }, [screen, ticketRef]);

  const refreshNotes = () => api.notifications().then(setNotes).catch(() => {});

  useEffect(() => {
    if (!me) return;
    refreshNotes();
    Promise.all([api.tickets({}), api.tickets({ awaiting: true })])
      .then(([all, awaiting]) => {
        const c = { awaiting: awaiting.tickets.length };
        all.tickets.forEach((t) => {
          c[t.status] = (c[t.status] || 0) + 1;
          // Watched-group badges count what is still live, not the whole history —
          // a badge that includes deals lost in March is not a number anyone can use.
          if (t.group && !["Lost", "Cancel", "Proposal Accepted / Ready to Ship"]
              .includes(t.status)) {
            const k = `g:${t.group}`;
            c[k] = (c[k] || 0) + 1;
          }
        });
        setCounts(c);
      })
      .catch(() => {});
  }, [me, tick]);

  const open = (ref) => { setTicketRef(ref); setScreen("detail"); setNavOpen(false); };
  const go = (id) => { setScreen(id); setNavOpen(false); };

  if (err)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
          <span className="mx-auto grid h-8 w-8 place-items-center rounded bg-[#EE1B2C] text-sm font-extrabold text-white">N</span>
          <h1 className="mt-3 text-lg font-semibold">Ninja PNS</h1>
          <p className="mt-2 text-sm text-slate-600">{err}</p>
          <p className="mt-4 border-t border-slate-100 pt-4 text-[12px] text-slate-500">
            Google signed you in, but access to this app is granted per person. An
            administrator adds you under Administration → Users.
          </p>
        </div>
      </main>
    );

  if (!me)
    return <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">Loading…</main>;

  const screens = {
    dashboard: <Dashboard me={me} onOpen={open} />,
    mine: <Mine me={me} onOpen={open} />,
    workload: <Workload />,
    sync: <Sync notify={notify} />,
    new: <NewRequest me={me} notify={notify} onCreated={open} />,
    open: <Open me={me} notify={notify} onOpen={open} />,
    crmid: <PendingCrmId me={me} notify={notify} onOpen={open} />,
    awaiting: <AwaitingPrice me={me} notify={notify} onOpen={open} />,
    review: <ToReview me={me} notify={notify} onOpen={open} />,
    head: <HeadReview me={me} notify={notify} onOpen={open} />,
    signoff: <ExecSignoff me={me} notify={notify} onOpen={open} />,
    "psp-pending": <PspPending me={me} notify={notify} onOpen={open} />,
    proposals: <Proposals me={me} notify={notify} onOpen={open} />,
    ship: <ReadyToShip me={me} onOpen={open} />,
    meeting: <ReviewMeeting onOpen={open} />,
    weekly: <WeeklyMeeting onOpen={open} />,
    rdo: <Rdo onOpen={open} />,
    ignored: <Ignored notify={notify} />,
    accounts: <Accounts onOpen={open} />,
    "g-hypercare": <Watched me={me} notify={notify} onOpen={open} group="Hypercare" />,
    "g-strategic": <Watched me={me} notify={notify} onOpen={open} group="Strategic" />,
    "g-mustwin": <Watched me={me} notify={notify} onOpen={open} group="Must Win" />,
    statusflow: <StatusFlow />,
    checks: <DataChecks me={me} onOpen={open} />,
    detail: <TicketDetail ticketRef={ticketRef} me={me} notify={notify} onBack={() => go("dashboard")} />,
    "capa-all": <Capa view="all" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-new": <Capa view="new" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-submitted": <Capa view="submitted" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-closed": <Capa view="closed" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-raise": <NewCapa notify={notify} onCreated={() => go("capa-all")} />,
    guide: <Guide onGo={go} />,
    handover: <ToHandOver me={me} notify={notify} onOpen={open} />,
    onboarding: <Onboarding onOpen={open} />,
    matrix: <Matrix />,
    changelog: <Changelog />,
    users: <Users me={me} notify={notify} />,
    bin: <RecycleBin me={me} notify={notify} onOpen={open} />,
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {NAV.map(([group, items]) => {
        const shown = items.filter((i) => !i.when || i.when(me));
        if (!shown.length) return null;
        return (
          <div key={group}>
            <div className="mb-1.5 px-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              {group}
            </div>
            {shown.map((i) => {
              const n = i.count ? counts[i.count] : undefined;
              const on = screen === i.id;
              return (
                <button key={i.id} onClick={() => go(i.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                    on ? "bg-rose-50 font-semibold text-[#EE1B2C]" : "text-slate-600 hover:bg-slate-100"
                  }`}>
                  <span className="w-4 shrink-0 text-center opacity-60">{i.icon}</span>
                  <span className="truncate">{i.label}</span>
                  {i.tag && (
                    <span className="rounded bg-amber-100 px-1 text-[9.5px] font-bold uppercase tracking-wide text-amber-700">
                      {i.tag}
                    </span>
                  )}
                  {n > 0 && (
                    // The badge is a live count of tickets sitting in this status —
                    // it is not part of the menu name.
                    <span title={`${n} ticket${n === 1 ? "" : "s"} currently here`}
                      className={`ml-auto rounded-full px-1.5 font-mono text-[11px] tabular-nums ${
                      on ? "bg-[#EE1B2C] text-white" : "bg-slate-200 text-slate-600"}`}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
      <div className="mt-auto px-2 pt-4 text-[11px] leading-relaxed text-slate-400">
        <p>Cost and margin are visible to PNS, PSP and CSO only.</p>
        {/* So "is my change live yet?" is answerable without devtools. */}
        <p className="mt-2 font-mono">build {me.build}</p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <button onClick={() => setNavOpen(!navOpen)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] lg:hidden">☰</button>
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded bg-[#EE1B2C] text-xs font-extrabold text-white">N</span>
          <span className="hidden font-bold tracking-tight sm:inline">Ninja PNS</span>
        </div>
        <GlobalSearch me={me} onOpenTicket={open} onGo={go} />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-500 sm:inline">Signed in as</span>
          <b className="hidden sm:inline">{me.name}</b>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {me.group}{me.level === "head" ? " · Head" : ""}
          </span>
          <Bell notes={notes} onRead={() => api.markRead().then(refreshNotes)} />
        </div>
      </header>

      {me.dev_fallback && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900 sm:px-6">
          <b>DEV_USER_EMAIL is still set.</b> This request was not identified by SSO, so
          everyone who opens this link is treated as <b>{me.name}</b> — including delete
          rights. Clear the variable in the Substrait portal under Settings.
        </div>
      )}

      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
          {sidebar}
        </aside>
        {navOpen && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/30" onClick={() => setNavOpen(false)} />
            <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white">{sidebar}</aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {screens[screen] || screens.dashboard}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
