import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Dashboard from "./screens/Dashboard";
import Matrix from "./screens/Matrix";
import Capa from "./screens/Capa";
import Users from "./screens/Users";
import TicketDetail from "./screens/TicketDetail";
import { NewRequest, NewCapa } from "./screens/Forms";
import {
  AwaitingPrice, ToReview, HeadReview, PspApprovals,
  Proposals, ReadyToShip, RecycleBin, Meeting,
} from "./screens/Queues";

// One nav entry per screen. `when` reads the permission map the backend sends, so the
// sidebar and the API agree on who may do what — there is no second rule set here.
const NAV = [
  ["Solutioning", [
    { id: "dashboard", label: "Dashboard", icon: "▤" },
    { id: "new", label: "New request", icon: "＋", when: (m) => m.permissions.createTicket },
    { id: "awaiting", label: "Awaiting price", icon: "◷", count: "awaiting" },
    { id: "review", label: "To review", icon: "◎", count: "Pending PNS Review",
      when: (m) => m.group === "PNS" || m.group === "Admin" },
    { id: "head", label: "Need review", icon: "⚑", count: "Pending Head Review",
      when: (m) => m.permissions.headAck },
    { id: "psp", label: "Price approvals", icon: "✓", count: "Pending PSP Approval",
      when: (m) => m.group !== "Legal" },
    { id: "proposals", label: "Proposal submitted", icon: "◫", count: "Proposal Submitted" },
    { id: "ship", label: "Ready to ship", icon: "➔", count: "Proposal Accepted / Ready to Ship" },
    { id: "meeting", label: "Weekly meeting", icon: "☷" },
    { id: "detail", label: "Ticket detail", icon: "⋯" },
  ]],
  ["CAPA", [
    { id: "capa-all", label: "All CAPA", icon: "▤" },
    { id: "capa-new", label: "New", icon: "◷", when: (m) => m.group === "PNS" || m.group === "Admin" },
    { id: "capa-submitted", label: "Submitted", icon: "◫" },
    { id: "capa-closed", label: "Closed", icon: "✓" },
    { id: "capa-raise", label: "Raise CAPA", icon: "＋", when: (m) => m.permissions.capaRaise },
  ]],
  ["Reference", [
    { id: "matrix", label: "Routing & limits", icon: "☰" },
  ]],
  ["Administration", [
    { id: "users", label: "Users & roles", icon: "👤", when: (m) => m.permissions.manageUsers },
    { id: "bin", label: "Recycle bin", icon: "♲", when: (m) => m.permissions.deleteTicket },
  ]],
];

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
        What&apos;s new{" "}
        <span className={`ml-1 rounded-full px-1.5 text-[11px] ${
          notes.unread ? "bg-[#EE1B2C] text-white" : "bg-slate-100 text-slate-500"}`}>
          {notes.unread}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-[60vh] w-96 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <b className="text-sm">What&apos;s new for you</b>
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
    // Emails link to /?ticket=SOF-1234. The app has no router, so read it once on load
    // and open that ticket, then clean the URL so a refresh doesn't jump back here.
    const wanted = new URLSearchParams(window.location.search).get("ticket");
    if (wanted) {
      setTicketRef(wanted);
      setScreen("detail");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const refreshNotes = () => api.notifications().then(setNotes).catch(() => {});

  useEffect(() => {
    if (!me) return;
    refreshNotes();
    Promise.all([api.tickets({}), api.tickets({ awaiting: true })])
      .then(([all, awaiting]) => {
        const c = { awaiting: awaiting.tickets.length };
        all.tickets.forEach((t) => { c[t.status] = (c[t.status] || 0) + 1; });
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
    new: <NewRequest me={me} notify={notify} onCreated={open} />,
    awaiting: <AwaitingPrice me={me} notify={notify} onOpen={open} />,
    review: <ToReview me={me} notify={notify} onOpen={open} />,
    head: <HeadReview me={me} notify={notify} onOpen={open} />,
    psp: <PspApprovals me={me} notify={notify} onOpen={open} />,
    proposals: <Proposals me={me} notify={notify} onOpen={open} />,
    ship: <ReadyToShip onOpen={open} />,
    meeting: <Meeting onOpen={open} />,
    detail: <TicketDetail ticketRef={ticketRef} me={me} notify={notify} onBack={() => go("dashboard")} />,
    "capa-all": <Capa view="all" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-new": <Capa view="new" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-submitted": <Capa view="submitted" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-closed": <Capa view="closed" me={me} notify={notify} onRaise={() => go("capa-raise")} />,
    "capa-raise": <NewCapa notify={notify} onCreated={() => go("capa-all")} />,
    matrix: <Matrix />,
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
                  {n > 0 && (
                    <span className={`ml-auto rounded-full px-1.5 font-mono text-[11px] tabular-nums ${
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
          <span className="font-bold tracking-tight">Ninja PNS</span>
        </div>
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
