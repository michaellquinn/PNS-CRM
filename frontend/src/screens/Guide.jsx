import { useState } from "react";
import { Card, Head, Pill } from "../ui";

// Task-first help. Nobody arrives asking "what does Pending Review - PSP mean"; they
// arrive asking "I priced it, now what?". So the entry point is a list of things people
// actually want to do, each answered in a few steps that name the screen to open — and
// the screen names are real, so "Go there" navigates instead of describing.

const TASKS = [
  {
    q: "I want to raise a new request",
    who: "Sales",
    go: "new",
    steps: [
      "Open New request and fill the intake. Shipper, service, potential revenue and the brief are what routing reads.",
      "On save the app decides who prices it: managed accounts (Hypercare/Strategic), FTL monthly and Sameday always go to PNS; everything else stays with Sales, with a PNS review above Rp 30 Mio.",
      "The ticket appears in Awaiting price for whoever owes it, and in My requests for you.",
    ],
  },
  {
    q: "I want to attach a price",
    who: "PNS or Sales, whoever owes it",
    go: "awaiting",
    steps: [
      "Open Awaiting price and find the ticket. Build the price from the linked rate card.",
      "Paste the link to the pricing spreadsheet, then state margin % and discount %. Leaving them blank is allowed — a standard rate card has nothing to declare — but then nothing is checked either.",
      "Press Attach price. The 5A tier guard runs immediately and decides where the ticket goes next: straight out, or to one of the review gates.",
    ],
    note: "During the PNS pilot, PNS can attach prices on Sales-owed tickets too.",
  },
  {
    q: "I want to know why my ticket went to a review queue",
    who: "Anyone",
    go: "matrix",
    steps: [
      "Below the tier floor → Pending Review - PSP first, then Pending Review - Head Sales. PSP settles whether the margin is survivable; the Sales Head then decides whether Sales will wear the concession. Where PSP does not take the ticket, it goes straight to the Sales Head and they are the only gate.",
      "Sales priced it and it is at or above Rp 30 Mio (non-managed) → Pending Review - Head PNS.",
      "Managed account, Sameday discount over 20%, FTL at or above Rp 30 Mio, or an escalation → Pending Review - PSP.",
      "Hypercare or Strategic, after every other gate → Pending Review - C-level (Alex and Dhinesh).",
      "Routing & limits has the full table of ceilings per service and revenue band.",
    ],
  },
  {
    q: "I want to approve a price below the floor",
    who: "Sales Head (PNS Head during the pilot)",
    go: "head",
    steps: [
      "Open Review - Head Sales. Each card shows the submitted margin and the attached spreadsheet. If the ticket went through PSP, they have already approved the margin — what is left is the commercial concession.",
      "Acknowledge to release it. This is the last gate on that path, so the proposal goes out (or to C-level sign-off on a managed account).",
      "Or type a note and Send back, which returns it to whoever priced it with your reason attached.",
    ],
  },
  {
    q: "I want to approve or reject a margin (PSP)",
    who: "PSP; the PNS Head may decide in PSP's place",
    go: "psp-pending",
    steps: [
      "Open Review - PSP. It is one shared queue with nobody assigned — any PSP member decides any ticket. Switch to Already decided for PSP's history.",
      "Approve price releases it; Reject needs a note and sends it back to the pricer.",
      "If you are the PNS Head deciding because PSP is unavailable, the note is mandatory and the decision is recorded as an override, never as a PSP decision.",
    ],
  },
  {
    q: "I want to send a non-managed ticket to PSP",
    who: "PNS Head",
    go: null,
    steps: [
      "PSP only takes managed accounts, unless Alex (CSO) granted a one-off exception.",
      "Open the ticket, find PSP exception request in the Ownership panel, and type what Alex granted and where.",
      "One button: Send to PSP on this exception. It records what Alex granted and moves the ticket in the same action.",
    ],
  },
  {
    q: "I want to record that the shipper accepted or declined",
    who: "Sales",
    go: "proposals",
    steps: [
      "Open Proposal submitted and find the ticket.",
      "Proposal accepted moves it to Ready to Ship, and the deal appears under Onboarding once Sales adds the shipper ID and go-live date.",
      "For a loss, choose the reason from the dropdown — the reason is what makes the win-rate number mean anything.",
      "Changed your mind, or the shipper came back? Reopen a lost or cancelled deal from the ticket itself; any salesperson can.",
    ],
  },
  {
    q: "I want to assign or reassign work",
    who: "PNS Head (PNS side) · Sales Head or Sales Manager (Sales PIC)",
    go: null,
    steps: [
      "Open the ticket. The Ownership panel holds PNS owner, PNS price reviewer and Sales PIC. PSP has no PIC — it works one shared queue.",
      "Workload shows how loaded each PNS member is. The auto-assigner caps everyone at 10 tickets at Pending PNS; past that a ticket stays unassigned and the Head is notified.",
      "Every list shows PNS unassigned in amber when nobody owns a ticket.",
    ],
  },
  {
    q: "What is a PNS price reviewer, and is that PSP?",
    who: "Anyone",
    go: "review",
    steps: [
      "No — the price reviewer is a PNS colleague, not PSP. When SALES builds a price on a non-managed deal at or above Rp 30 Mio, a second pair of PNS eyes checks it before it reaches the shipper. That is the reviewer.",
      "PSP is a different question entirely: is this margin acceptable to the business. PSP never reviews the workings, only the number.",
      "Reviews are now delegated automatically to a standing reviewer rather than queueing for the PNS Head, and any PNS member can claim one themselves from the ticket.",
    ],
  },
  {
    q: "I want to hand a won deal to Ops",
    who: "Sales, then PNS",
    go: "handover",
    steps: [
      "Open To hand over under Onboarding. It lists every accepted deal that Ops cannot start yet.",
      "Fill in the shipper ID and go-live date inline — parent shipper ID and branch ID too if you have them — and save. The ticket moves to Onboarding, sorted by go-live date.",
      "Then open the ticket and press Send Kick-off to PNS, Sales & Ops. That email carries no pricing at all and points back at the Charter as the source of truth.",
    ],
  },
  {
    q: "I want to see only my own tickets",
    who: "Anyone",
    go: "mine",
    steps: [
      "My requests is the personal view: what you raised (Sales) or what you were assigned (PNS), with what you owe a move on first.",
      "Every queue also has an Assigned to me toggle and a PNS PIC dropdown, so you can narrow any list without leaving it.",
      "The Waiting on me tile on the dashboard counts your still-pending tickets.",
    ],
  },
  {
    q: "I want to find a ticket",
    who: "Anyone",
    go: null,
    steps: [
      "Use the search bar in the header — press / from anywhere to jump into it.",
      "It matches ticket reference, shipper name and the Sales CRM opportunity id, so the number a salesperson is holding works either way.",
      "It also finds screens: type psp or sales and pick the view from the list.",
    ],
  },
  {
    q: "I want to publish the Project Charter",
    who: "PNS",
    go: null,
    steps: [
      "Open the ticket, Project Charter tab. It is generated from the intake and never carries cost or margin.",
      "Sections 1–3 are the charter itself (solutioning), tagged Charter. Section 4 is tagged Kick-off: the go-live date and the account-system IDs Ops need.",
      "Copy for email puts it on the clipboard as a formatted table. Send Charter to PNS & Sales publishes it and records who received it — it stays disabled until the intake is cleared. Once the shipper accepts, a second button sends the Kick-off to PNS, Sales and Ops; that one carries no pricing at all.",
    ],
  },
  {
    q: "I want to pull the latest from Sales CRM",
    who: "The sync owner",
    go: "sync",
    steps: [
      "New + refresh is the routine morning run. The day window is the opportunity's creation date, not its last edit.",
      "Re-check held tickets only ignores dates and re-reads every opportunity behind a ticket you hold — this is how you find deals that closed in Sales CRM after they were imported.",
      "A closed Sales CRM stage now moves our status: Closed-Lost becomes Lost, the accepted stages become Ready to Ship, and if the onboarding fields are blank, PNS and Sales are told which ones.",
      "Always dry run first. Nothing is ever written back to Sales CRM.",
    ],
  },
  {
    q: "I want to delete a ticket that should not exist",
    who: "PNS Head or Admin",
    go: null,
    steps: [
      "Open the ticket and press Delete ticket. It leaves every list but keeps its history.",
      "Recycle bin holds it; Restore puts it back exactly where it was.",
      "Erasing it permanently is Admin-only and only possible from the bin — there is deliberately no one-step hard delete.",
    ],
  },
];

export default function Guide({ onGo }) {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? TASKS.filter((t) =>
        `${t.q} ${t.who} ${t.steps.join(" ")}`.toLowerCase().includes(needle))
    : TASKS;

  return (
    <>
      <Head title="How do I…"
        sub="Every flow in the app, written as the thing you are trying to do. Open to everyone — the steps are the same whatever your role; the buttons you see depend on it." />

      <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="What are you trying to do? e.g. price, approve, reassign, delete…"
        className="mb-4 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-[13.5px]" />

      <div className="flex flex-col gap-2.5">
        {shown.map((t, i) => {
          const on = open === i;
          return (
            <Card key={t.q}>
              <button onClick={() => setOpen(on ? null : i)} aria-expanded={on}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <span className="text-[15px] font-semibold">{t.q}</span>
                <Pill tone="bg-slate-100 text-slate-600">{t.who}</Pill>
                <span className="ml-auto text-slate-400">{on ? "−" : "+"}</span>
              </button>
              {on && (
                <div className="border-t border-slate-100 px-4 py-4">
                  <ol className="flex list-none flex-col gap-2.5 p-0">
                    {t.steps.map((s, n) => (
                      <li key={n} className="flex gap-3 text-[13.5px] leading-relaxed">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-50 font-mono text-[11px] font-bold text-[#EE1B2C]">
                          {n + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  {t.note && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                      {t.note}
                    </p>
                  )}
                  {t.go && (
                    <button onClick={() => onGo(t.go)}
                      className="mt-3 rounded-lg border border-[#EE1B2C] bg-[#EE1B2C] px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
                      Take me there
                    </button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {shown.length === 0 && (
          <Card className="p-8 text-center text-sm text-slate-400">
            Nothing matches “{q.trim()}”. Try a verb: price, approve, assign, sync, delete.
          </Card>
        )}
      </div>

      <Card className="mt-5 p-4">
        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          The pipeline in one line
        </div>
        <p className="text-[13px] leading-relaxed text-slate-600">
          Intake → the responsible side prices it → the gates that its rule triggered clear
          in order (<b>Head PNS</b> for Sales-priced big deals, <b>Head Sales</b> for a price
          below the floor, <b>PSP</b> for the margin, <b>C-level</b> for managed accounts,
          always last) → the proposal goes out → Sales records won or lost → the charter is
          published and Ops onboard. Everything else in this app is a way of seeing where a
          ticket currently sits in that line.
        </p>
      </Card>
    </>
  );
}
