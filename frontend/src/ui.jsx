// Shared primitives. Status keeps its own muted register — Ninja red (#EE1B2C) is
// reserved for brand and actions, so a filled red thing always means "act on me".

import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Who a ticket or CAPA can be assigned to. Read from the users table rather than a
// hardcoded list, so registering someone in Administration puts them in the dropdowns.
let assignableOnce;

export function usePnsTeam() {
  const [names, setNames] = useState([]);
  useEffect(() => {
    assignableOnce ||= api.assignable().then((d) => d.names);
    assignableOnce.then(setNames).catch(() => setNames([]));
  }, []);
  return names;
}

export function refreshPnsTeam() {
  assignableOnce = undefined;
}

// Dropdown values, including the ones people have typed on past tickets.
let optionsOnce;

export function useOptions() {
  const [o, setO] = useState(null);
  useEffect(() => {
    optionsOnce ||= api.options();
    optionsOnce.then(setO).catch(() => setO(null));
  }, []);
  return o;
}

export function refreshOptions() {
  optionsOnce = undefined;
}

// Everyone taggable in a ticket discussion.
let directoryOnce;

export function useDirectory() {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    directoryOnce ||= api.directory().then((d) => d.people);
    directoryOnce.then(setPeople).catch(() => setPeople([]));
  }, []);
  return people;
}

const TONE = {
  // Amber-red: not a queue anybody works, a ticket that cannot move until somebody
  // supplies the one number tying it to Sales CRM.
  "Pending CRM ID": "bg-rose-50 text-rose-700",
  // Green because it is good news — ready, complete, waiting for a pair of hands.
  Open: "bg-emerald-50 text-emerald-700",
  "Pending Sales": "bg-sky-50 text-sky-700",
  "Pending PNS": "bg-violet-50 text-violet-700",
  "Pending Review - Head PNS": "bg-violet-50 text-violet-700",
  "Pending Review - PSP": "bg-amber-50 text-amber-700",
  "Pending Review - Head PSP": "bg-amber-100 text-amber-900",
  "Pending Vendor": "bg-slate-100 text-slate-600",
  // Executive sign-off is the last gate before a proposal goes out — coloured apart
  // from the other approvals so it reads as the end of the queue, not another step.
  "Pending Review - C-level": "bg-fuchsia-50 text-fuchsia-700",
  "Proposal Submitted": "bg-teal-50 text-teal-700",
  "Proposal Accepted / Ready to Ship": "bg-emerald-50 text-emerald-700",
  Lost: "bg-rose-50 text-rose-700",
  Cancel: "bg-slate-100 text-slate-600",
  Sales: "bg-sky-50 text-sky-700",
  PNS: "bg-violet-50 text-violet-700",
  Submitted: "bg-sky-50 text-sky-700",
  "CAPA Closed": "bg-slate-100 text-slate-600",
};

export function Pill({ children, dot = false, tone }) {
  const cls = tone || TONE[children] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// Sales CRM's commercial stage, styled to match our status pill in shape and weight but
// deliberately not in colour (Baskoro, 2026-08-14: "similar design ... important to
// show"). Both are states and both matter at a glance, so a coloured pill next to bare
// grey text made one look like data and the other like a footnote. Outlined slate says
// "a state, from the other system" without competing with the status palette.
export function StagePill({ children }) {
  if (!children) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      {children}
    </span>
  );
}

export function Tile({ label, value, sub, tone, onClick, on }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} type={onClick ? "button" : undefined}
      className={`rounded-xl border bg-white px-4 py-3.5 text-left ${
        on ? "border-[#EE1B2C] ring-1 ring-[#EE1B2C]" : "border-slate-200"} ${
        onClick ? "cursor-pointer hover:border-slate-400" : ""}`}>
      {/* Not truncated: these carry full status names now ("Pending Review - Head
          Sales"), and a clipped label defeats the whole point of the tile. */}
      <div className="min-h-[2.4em] text-[12.5px] font-medium leading-snug text-slate-600">{label}</div>
      <div className={`mt-1.5 font-mono text-[27px] font-bold leading-none tabular-nums tracking-tight ${tone || "text-slate-900"}`}>
        {value}
      </div>
      <div className="mt-1 truncate text-[11.5px] text-slate-400">{sub || " "}</div>
    </Tag>
  );
}

export function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] ${
        on
          ? "border-[#EE1B2C] bg-[#EE1B2C] font-semibold text-white"
          : "border-slate-300 bg-white font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

export function Btn({ children, kind = "plain", onClick, disabled, type = "button", className = "" }) {
  const styles = {
    plain: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    primary: "border-[#EE1B2C] bg-[#EE1B2C] text-white hover:brightness-110",
    danger: "border-rose-300 bg-white text-rose-600 hover:bg-rose-50",
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function Head({ title, sub, right }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-slate-600">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }) {
  return <Card className="p-10 text-center text-sm text-slate-400">{children}</Card>;
}

export function Field({ label, hint, required, children, span }) {
  return (
    <div className={span ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-[11.5px] font-semibold text-slate-600">
        {label} {required && <span className="text-[#EE1B2C]">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] focus:border-slate-400 focus:outline-none";

// Type anything; past answers are offered as suggestions. A fixed <select> cannot
// anticipate every commodity Ninja carries, and forcing one loses the real answer.
let comboSeq = 0;

export function Combo({ value, onChange, options = [], placeholder, disabled }) {
  const [id] = useState(() => `combo-${++comboSeq}`);
  return (
    <>
      <input
        list={id} className={inputCls} value={value || ""} placeholder={placeholder}
        disabled={disabled} onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

// Destructive actions get a real dialog. window.confirm is blocked in some embeds,
// which once made the delete button look like it silently did nothing.
export function Confirm({ open, title, body, confirmLabel = "Confirm", onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {body && <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn kind="danger" onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  );
}

// The attached price. A link opens the spreadsheet; without one it degrades to the label,
// because plenty of older tickets only ever had a filename typed into them.
export function PriceChip({ file, url, empty = "not yet priced" }) {
  if (!file && !url) return <span className="text-slate-400">{empty}</span>;
  const label = file || url;
  if (!url) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[12.5px] text-slate-700">
        📎 {label}
        <span className="text-[11px] text-slate-400">(name only, no link)</span>
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[12.5px] font-medium text-sky-800 hover:underline">
      <span>🔗</span>
      <span className="truncate">{label}</span>
      <span className="text-[11px] opacity-60">opens in a new tab</span>
    </a>
  );
}

export function Sla({ elapsed, target }) {
  const over = elapsed > target;
  return (
    <span className={`font-mono tabular-nums ${over ? "font-bold text-rose-600" : "text-slate-600"}`}>
      {elapsed} / {target}d
    </span>
  );
}

// One row per ticket in the queue screens. Actions differ per screen, so they're passed in.
export function TicketCard({ t, badges = [], children, onOpen }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The whole header opens the ticket, not just the reference. The action area
            below (children) is deliberately outside it — a click meant for "Attach
            price" must not navigate away instead. */}
        <div
          role={onOpen ? "button" : undefined}
          tabIndex={onOpen ? 0 : undefined}
          onClick={() => onOpen?.(t.ref)}
          onKeyDown={(e) => {
            if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(t.ref); }
          }}
          className={`min-w-0 ${onOpen ? "-m-1 cursor-pointer rounded-lg p-1 hover:bg-slate-50" : ""}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-bold text-[#EE1B2C] group-hover:underline">
              {t.ref}
            </span>
            <Pill dot>{t.status}</Pill>
            {/* One of the three watched groups. Must Win is per-deal, so it can appear
                on an otherwise Standard account and must be visible at a glance. */}
            {t.must_win && <Pill tone="bg-orange-100 text-orange-800">Must Win</Pill>}
            {/* On a synced loss our own reason is the generic "Closed in Sales CRM",
                which explains nothing. Sales CRM's own reason is shown instead wherever
                the ticket appears (Baskoro, 2026-08-18).

                Gated on the ticket ACTUALLY being lost (Michael, 2026-08-21). The sync
                copies loss_reason from Sales CRM on every run whatever the stage says,
                so an opportunity that was marked a duplicate and then revived still
                carries the reason — and this pill was reading that as "lost" and
                stamping a live, submitted proposal with a red Lost badge. */}
            {t.status === "Lost" && t.crm_loss_reason && (
              <Pill tone="bg-rose-50 text-rose-700">Lost: {t.crm_loss_reason}</Pill>
            )}
            {t.open_questions > 0 && (
              <Pill tone="bg-amber-50 text-amber-700">
                {t.open_questions} unanswered
              </Pill>
            )}
            {badges}
          </div>
          <h3 className="truncate text-[15px] font-semibold">{t.shipper}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {t.service} &middot; {t.acct_type} &middot; {t.revenue.toLocaleString("id-ID")} &middot; {t.region}
            {t.sales && <> &middot; sales {t.sales}</>}
            {/* Assignment is stated even when empty: PNS works by ticket assignment,
                so "nobody owns this yet" must be visible, not blank. */}
            {t.owner
              ? <> &middot; PNS {t.owner}</>
              : <> &middot; <span className="font-semibold text-amber-600">PNS unassigned</span></>}
          </p>
        </div>
        <Sla elapsed={t.sla_elapsed} target={t.sla_target} />
      </div>
      {children && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
    </Card>
  );
}

// A dropdown that multi-selects. Shared by the dashboards' Status/Service/Group and by
// the Review meeting's Salesperson/PNS PIC (Michael, 2026-08-18: those had to stay
// multi-select but a row of thirty name pills is what made the bar unreadable).
//
// Status, Service and Group were three rows of chips — twenty-five pills wrapping over
// five lines and pushing the table below the fold before anyone had filtered anything.
// They collapse into dropdowns here, and the multi-select is the whole point of keeping
// them: a native <select multiple> is the control nobody can operate without being told
// to hold ctrl, so the panel holds ordinary checkboxes and stays open while you tick
// several. The button reads the one thing you want at a glance — what is picked.
//
// `sections` is [{ label, items: [{ key, label, on, toggle, n }] }]. Each item carries
// its own toggle because Group mixes two different filters in one list: Hypercare and
// Strategic are account tiers (f.acct), Must Win is a per-deal flag (f.group), and the
// reader scanning for "how much attention does this need" should not have to care.
export function MultiSelect({ label, sections, picked, onClear }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className={`flex min-w-[178px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] ${
          picked.length
            ? "border-[#EE1B2C] bg-rose-50 font-semibold text-[#EE1B2C]"
            : "border-slate-300 bg-white"}`}>
        <span className="truncate">
          {/* One pick reads as itself, and it has to be the item's LABEL, not its key —
              a key like __unassigned__ would otherwise leak onto the button. */}
          {picked.length === 0 ? `Any ${label.toLowerCase()}`
            : picked.length === 1
              ? (sections.flatMap((s) => s.items).find((i) => i.key === picked[0])?.label
                 ?? picked[0])
            : `${label} · ${picked.length}`}
        </span>
        <span className="ml-auto shrink-0 opacity-40">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 max-h-[58vh] w-[272px] overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {sections.map((sec, i) => (
            <div key={sec.label || i}>
              {sec.label && (
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {sec.label}
                </div>
              )}
              {sec.items.map((it) => (
                <label key={it.key}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-slate-50">
                  <input type="checkbox" checked={it.on} onChange={it.toggle} />
                  <span className="truncate">{it.label}</span>
                  {it.n > 0 && (
                    <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                      {it.n}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ))}
          {picked.length > 0 && (
            <button onClick={onClear}
              className="mt-1 w-full border-t border-slate-100 px-2 pt-2 text-left text-[12.5px] text-slate-500 hover:text-[#EE1B2C]">
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// State that survives leaving the screen and coming back (Michael, 2026-08-18). Opening
// a ticket from a filtered queue unmounts that queue, so its filter was reset by the
// time you came back — and on a review call, where you pick a ticket, discuss it and
// return for the next one, that meant re-filtering for every single ticket.
//
// sessionStorage rather than localStorage on purpose: it survives navigation and a
// reload, which is the whole complaint, but it does not leave a filter set from last
// Tuesday quietly hiding rows next week. Closing the tab is the reset.
export function useSticky(key, initial) {
  const [v, setV] = useState(() => {
    // No key means "do not persist" — a caller that forgot one gets ordinary state
    // rather than silently sharing a bucket with every other caller that forgot.
    if (!key) return initial;
    try {
      const saved = JSON.parse(sessionStorage.getItem("nx:" + key) || "null");
      if (saved == null) return initial;
      // Arrays FIRST. typeof [] is "object", so without this an array fell into the
      // object merge below and came back as {...[]} — a plain object, not an array —
      // and the next .join()/.length on it threw and took the whole app down. It only
      // showed on the SECOND visit, because the first had nothing saved to restore.
      if (Array.isArray(initial)) return Array.isArray(saved) ? saved : initial;
      // Anything not an object round-trips as itself, if the type still matches.
      if (typeof initial !== "object" || initial === null) {
        return typeof saved === typeof initial ? saved : initial;
      }
      // An object initial needs an object back; a saved array here is a shape change.
      if (typeof saved !== "object" || Array.isArray(saved)) return initial;
      // Merge onto the CURRENT shape and drop anything whose shape has changed. A filter
      // saved before a control became multi-select would otherwise come back as a bare
      // string where an array is expected and quietly match nothing.
      const out = { ...initial };
      for (const [k, val] of Object.entries(saved)) {
        if (!(k in initial)) continue;
        if (Array.isArray(initial[k]) !== Array.isArray(val)) continue;
        out[k] = val;
      }
      return out;
    } catch {
      return initial;          // private mode, quota, corrupt JSON — never block the screen
    }
  });
  useEffect(() => {
    if (!key) return;
    try { sessionStorage.setItem("nx:" + key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key, v]);
  return [v, setV];
}
