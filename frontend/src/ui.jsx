// Shared primitives. Status keeps its own muted register — Ninja red (#EE1B2C) is
// reserved for brand and actions, so a filled red thing always means "act on me".

import { useEffect, useState } from "react";
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
  "Pending Sales": "bg-sky-50 text-sky-700",
  "Pending PNS": "bg-violet-50 text-violet-700",
  "Pending Review - Head PNS": "bg-violet-50 text-violet-700",
  "Pending Review - Head Sales": "bg-amber-50 text-amber-700",
  "Pending Review - PSP": "bg-amber-50 text-amber-700",
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
