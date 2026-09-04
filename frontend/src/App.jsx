import { Component, useCallback, useEffect, useState } from "react";
import { api, LIVE_STATUSES, NEW_TICKET_DAYS, isNewIncoming, isPnsWork } from "./api";
import Dashboard from "./screens/Dashboard";
import Matrix from "./screens/Matrix";
import Capa from "./screens/Capa";
import Users from "./screens/Users";
import TicketDetail from "./screens/TicketDetail";
import Workload from "./screens/Workload";
import Mine from "./screens/Mine";
import Sync from "./screens/Sync";
import ImportQueue from "./screens/ImportQueue";
import Changelog from "./screens/Changelog";
import Guide from "./screens/Guide";
import { Onboarding, ToHandOver } from "./screens/Onboarding";
import { NewRequest, NewCapa } from "./screens/Forms";
import Accounts from "./screens/Accounts";
import Ignored from "./screens/Ignored";
import Rdo from "./screens/Rdo";
import Fields from "./screens/Fields";
import { ReviewMeeting } from "./screens/Meetings";
import StatusFlow from "./screens/StatusFlow";
import DataChecks from "./screens/DataChecks";
import Cancelled from "./screens/Cancelled";
import {
  AwaitingPrice, NewIncoming, Open, PendingCrmId, ToReview, PspPending, ExecSignoff,
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
  // Reorganised to Michael's layout, 2026-08-18. The sections split by WHOSE WORK a
  // screen is, not by where a ticket sits in the pipeline. Sales CRM leads because that
  // is where a deal starts: it arrives from the sync, and only then becomes PNS's
  // (Michael, 2026-08-18) — the sidebar now reads in the order the work happens.
  // Everything that arrives from, or belongs to, the commercial side.
  // Dashboard, Open and Awaiting price - Sales all moved out to Solutioning
  // (Michael, 2026-09-01): now that Sales only submits a Sales CRM link or a manual
  // request, this section is what Sales actually does — raise it, and wait for a CRM
  // id if it does not have one yet — plus the account/administration screens that were
  // never really "Sales' work" either.
  ["Sales CRM", [
    { id: "new", label: "New request", icon: "＋", when: (m) => m.permissions.createTicket },
    { id: "crmid", label: "Pending CRM ID", icon: "⚠", count: "Pending CRM ID",
      keywords: "crm id missing blocked salesforce opportunity" },
    // A ticket is per opportunity; an account normally runs several at once.
    { id: "accounts", label: "Accounts", icon: "🏢",
      keywords: "account group shipper parent grouped duplicates opportunities" },
    // Open to everyone who can queue — Commercial, PNS, Sales Planning and Admin
    // (Michael, 2026-09-02). Admin-only between 2026-08-28 and then, on the reasoning
    // that Sales queue from the New request form and never need the screen. That holds
    // for putting something IN; the screen is where the OUTCOME is read — imported and
    // which ticket, skipped and why, failed and the error — so closing it meant asking
    // an admin whether your own request worked. Changing what the sync imports is still
    // Admin's: editSyncSettings gates the controls, not this entry.
    { id: "import-queue", label: "Import queue", icon: "⇪",
      when: (m) => m.permissions.manageImportQueue },
    { id: "sync", label: "Sync", icon: "⇄", when: (m) => m.permissions.syncSalesCrm },
  ]],
  // The step back from any single ticket: walking an agenda, reading capacity, and the
  // two late-stage states you report on rather than work.
  // What PNS works, once a deal has arrived.
  ["Solutioning", [
    // Dashboard all, renamed and moved here whole (Michael, 2026-09-01): with only
    // one board now — see Dashboard.jsx — there is nothing left for "PNS" to
    // disambiguate against, so the plain name is the accurate one.
    { id: "dashboard", label: "Dashboard", icon: "▤",
      keywords: "overview home stats everything whole book pns clean filtered" },
    // Under Dashboard (Michael, 2026-09-02): both answer "what is the state of
    // things" rather than naming a queue to work, and this is the narrow, recent
    // cut of the same book the board above shows. It answers the question people
    // open the app with after a batch goes in — did it arrive? The badge and the
    // screen share isNewIncoming(), so the count cannot disagree with the list.
    { id: "incoming", label: "New incoming", icon: "✦", count: "incoming",
      keywords: "new incoming just arrived latest recent today batch upload imported raised reopened restored back" },
    // Combined with the old Sales-CRM-section "Open" (Michael, 2026-09-01): with
    // Sales only submitting a link or a manual request, a Sales-side and a PNS-side
    // unclaimed-work screen were reading the same underlying queue through two
    // doors. See Queues.jsx for the merged filter — status Open, OR PNS's and
    // unowned in any live status. Unrestricted, like Open always was, not narrowed
    // to Open - PNS's PNS/Admin-only readership.
    { id: "open", label: "Open", icon: "○", count: "open",
      keywords: "open ready available not started yet both sides status unassigned unclaimed pns take claim assign nobody mine inbox" },
    { id: "mine", label: "My requests", icon: "◐", when: works,
      keywords: "my tickets assignment" },
    // Awaiting price - PNS and - Sales, renamed Pricing and both here now (Michael,
    // 2026-09-01): the Sales CRM section stopped being where Sales does pricing work
    // once Awaiting price - Sales moved out, so keeping half the pair there and half
    // here was two screens for one job, filed in two places.
    { id: "awaiting-pns", label: "Pricing - PNS", icon: "◷", count: "awaiting:pns",
      keywords: "pricing pns attach rate card" },
    { id: "awaiting-sales", label: "Pricing - Sales", icon: "◷",
      count: "awaiting:sales", keywords: "pricing sales attach rate card" },
    // NOT in Michael's list, kept deliberately: this is a live gate. Tickets reach
    // "Pending Review - PNS" and "Pending Review - Head PNS" by rule, and with no menu
    // entry there is no screen that can clear them — they would simply stop moving.
    { id: "review", label: "Review - PNS", icon: "◎", count: "review:pns",
      keywords: "pns review head finalise watched check sales price 30 mio second pair of eyes" },
    { id: "psp-pending", label: "Review - PSP", icon: "✓", count: "Pending Review - PSP",
      tag: "PSP", keywords: "psp pending margin approval decided finished history" },
    { id: "signoff", label: "Review - C-level", icon: "★", count: "Pending Review - C-level",
      keywords: "executive exec sign-off alex dhinesh cso coo" },
  ]],
  ["Planning", [
    // One entry for the whole review (Michael, 2026-08-21): proposals out with shippers
    // and everything still open are walked in the same sitting, so two entries meant
    // leaving the list to see the other half and losing your place. The separate
    // Proposal submitted screen still exists at ?screen=proposals for anyone with the
    // link, it is just not a second thing to click past in the menu.
    { id: "meeting", label: "Pending & proposals", icon: "☷", when: works,
      count: "Proposal Submitted",
      keywords: "agenda review meeting sales region salesperson walk the list pending proposal submitted" },
    // NOT in Michael's list, both kept: Ready to ship is the won-deal list Legal and Ops
    // read, and Workload is the only screen that answers "who has capacity".
    { id: "ship", label: "Ready to ship", icon: "➔",
      count: "Proposal Accepted / Ready to Ship" },
    { id: "workload", label: "Workload", icon: "◴", when: (m) => m.permissions.seeWorkload,
      keywords: "pns capacity assignment load who is free" },
    // What was dropped and why. In Planning rather than beside the working queues: it is
    // a record to read, not a list anybody works.
    { id: "cancelled", label: "Cancelled", icon: "⊗", count: "Cancel",
      keywords: "cancel cancelled dropped not feasible killed withdrawn why stopped" },
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
    { id: "fields", label: "Fields", icon: "▦",
      keywords: "required mandatory must fill sync sales crm overwrite which fields blocks" },
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

function Bell({ notes, onRead, onOpen }) {
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
          {/* A notification about a ticket now GOES to that ticket (Baskoro,
              2026-08-28). Reading "Annisa asked a question on SOF-4001340" and then
              having to search for the ticket by hand is the whole distance between a
              notification and a working inbox. Where the notification names a discussion
              thread, the ticket opens on that thread rather than on the ticket in
              general — being tagged in one of eight threads and landing on the ticket
              tells you almost nothing.

              A notification with no ticket behind it (a sync summary, a broadcast) is
              not clickable, and is rendered as plain text so it does not look like a
              dead link. */}
          {notes.notes.map((n) => {
            const body = (
              <>
                <p className="text-[13px] leading-snug">{n.body}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {n.at}{n.ticket_ref ? ` · ${n.ticket_ref}` : ""}
                  {n.thread_key ? " · thread" : ""}
                </p>
              </>
            );
            const cls = `block w-full border-b border-slate-100 px-4 py-3 text-left ${
              n.unread ? "bg-rose-50/40" : ""}`;
            return n.ticket_ref ? (
              <button key={n.id} type="button"
                className={`${cls} hover:bg-slate-50`}
                onClick={() => { setOpen(false); onOpen?.(n.ticket_ref, n.thread_key || null); }}>
                {body}
              </button>
            ) : (
              <div key={n.id} className={cls}>{body}</div>
            );
          })}

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

// One screen throwing used to blank the ENTIRE app: no header, no sidebar, no message,
// nothing in the page to say what happened or what to do (Michael hit exactly this on
// 2026-08-21). React unmounts the whole tree on an unhandled render error, and with no
// boundary there was nothing left to render.
//
// This keeps the shell and reports the failure. The "Clear saved filters" button is here
// on purpose rather than in a menu: a filter restored from sessionStorage in a shape the
// screen no longer understands is the most likely reason a screen crashes on open but
// not on a fresh tab, and it is not something a reload alone fixes.
class ScreenError extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidUpdate(prev) {
    // A different screen deserves a fresh attempt; without this the error sticks and
    // every other screen looks broken too.
    if (prev.screen !== this.props.screen && this.state.err) this.setState({ err: null });
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="text-[15px] font-semibold text-rose-900">This screen did not load</h2>
        <p className="mt-2 text-[13px] text-rose-800">
          The rest of the app still works — pick another screen from the menu. If it keeps
          happening, send this line to whoever is on the build:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-rose-200 bg-white p-3 text-[12px] text-rose-900">
          {String(this.state.err?.message || this.state.err)}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium"
            onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-medium"
            onClick={() => {
              try {
                Object.keys(sessionStorage)
                  .filter((k) => k.startsWith("nx:"))
                  .forEach((k) => sessionStorage.removeItem(k));
              } catch { /* nothing to clear */ }
              window.location.reload();
            }}>
            Clear saved filters and reload
          </button>
        </div>
      </div>
    );
  }
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
  // Cleared whenever a ticket is opened without one, so a thread from an earlier
  // notification cannot follow the reader onto the next ticket they open.
  const [focusThread, setFocusThread] = useState(null);
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
        const c = {
          awaiting: awaiting.tickets.length,
          // Split the same way the two menu entries are, on who owes the price now.
          "awaiting:pns": awaiting.tickets.filter((t) => t.priced_by === "PNS").length,
          "awaiting:sales": awaiting.tickets.filter((t) => t.priced_by === "Sales").length,
        };
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
        // One menu entry now covers both PNS gates, so its badge is their sum. Derived
        // here rather than in the nav table because `count` reads a single key.
        c["review:pns"] = (c["Pending Review - PNS"] || 0)
                        + (c["Pending Review - Head PNS"] || 0);
        // Mirrors the Open screen's own filter exactly (Queues.jsx), so the badge
        // and the list cannot answer differently: status Open, or PNS's and unowned
        // in any live status.
        // Same predicate the screen filters on, from the same module, so the badge
        // and the list are one answer. NEW_TICKET_DAYS is imported only to name the
        // window in the title below.
        c["incoming"] = all.tickets.filter(isNewIncoming).length;
        c["open"] = all.tickets.filter((t) => t.status === "Open"
          || (isPnsWork(t) && !t.owner && LIVE_STATUSES.includes(t.status))).length;
        setCounts(c);
      })
      .catch(() => {});
  }, [me, tick]);

  // `thread` is which discussion thread to land on, when the caller knows. A tag
  // notification names one; opening the ticket and leaving the reader to guess which of
  // eight threads wanted them is the complaint this answers (Baskoro, 2026-08-28).
  const open = (ref, thread = null) => {
    setTicketRef(ref);
    setFocusThread(thread);
    setScreen("detail");
    setNavOpen(false);
  };
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
    "import-queue": <ImportQueue me={me} notify={notify} onOpen={open} />,
    new: <NewRequest me={me} notify={notify} onCreated={open} />,
    incoming: <NewIncoming me={me} onOpen={open} />,
    open: <Open me={me} notify={notify} onOpen={open} />,
    crmid: <PendingCrmId me={me} notify={notify} onOpen={open} />,
    // Two entries, one component. `awaiting` stays routable so an emailed or pasted
    // ?screen=awaiting link from before the split still lands somewhere real.
    awaiting: <AwaitingPrice me={me} notify={notify} onOpen={open} />,
    "awaiting-pns": <AwaitingPrice me={me} notify={notify} onOpen={open} side="PNS" />,
    "awaiting-sales": <AwaitingPrice me={me} notify={notify} onOpen={open} side="Sales" />,
    review: <ToReview me={me} notify={notify} onOpen={open} />,
    signoff: <ExecSignoff me={me} notify={notify} onOpen={open} />,
    "psp-pending": <PspPending me={me} notify={notify} onOpen={open} />,
    proposals: <Proposals me={me} notify={notify} onOpen={open} />,
    ship: <ReadyToShip me={me} onOpen={open} />,
    meeting: <ReviewMeeting me={me} notify={notify} onOpen={open} />,
    rdo: <Rdo onOpen={open} />,
    fields: <Fields />,
    ignored: <Ignored notify={notify} />,
    accounts: <Accounts onOpen={open} />,
    "g-hypercare": <Watched me={me} notify={notify} onOpen={open} group="Hypercare" />,
    "g-strategic": <Watched me={me} notify={notify} onOpen={open} group="Strategic" />,
    "g-mustwin": <Watched me={me} notify={notify} onOpen={open} group="Must Win" />,
    statusflow: <StatusFlow />,
    checks: <DataChecks me={me} onOpen={open} notify={notify} />,
    cancelled: <Cancelled me={me} notify={notify} onOpen={open} />,
    detail: <TicketDetail ticketRef={ticketRef} me={me} notify={notify}
              focusThread={focusThread} onBack={() => go("dashboard")} />,
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
          <Bell notes={notes} onRead={() => api.markRead().then(refreshNotes)}
            onOpen={open} />
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
          <ScreenError screen={screen}>
            {screens[screen] || screens.dashboard}
          </ScreenError>
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
