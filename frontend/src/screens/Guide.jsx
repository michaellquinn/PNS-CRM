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
      "On save the app decides who prices it: managed accounts (Hypercare/Strategic), FTL monthly and Sameday always go to PNS; everything else stays with Sales, and a Sales price at or above Rp 30 Mio is checked by a PNS member afterwards.",
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
    q: "My ticket is stuck — what actually moves it?",
    who: "Anyone",
    go: "statusflow",
    steps: [
      "Two kinds of move, and telling them apart answers most of it. Most statuses are a CONSEQUENCE of doing something — attaching a price, the Head of PNS finalising, a signature, the Sales CRM sync — and the app works out where the ticket goes. That is why there is no dropdown for them: a person naming the next status is how an approval gets skipped.",
      "A few moves ARE a choice, and those have buttons: picking a ticket up from Open, sending it back with a reason, marking it Lost or Cancel, escalating to PSP.",
      "So if nothing is happening, the question is not “which status do I set?” but “what has not been done yet?”. Status flow lists, for every status, exactly what leads out of it, who does it and which button or screen it is.",
      "The two that stop a ticket dead: no Sales CRM opportunity id (it parks in Pending CRM ID and cannot move at all), and potential revenue 0 (it cannot enter any working status, because revenue decides who prices it, which 5A ceiling applies and whether PNS reviews it).",
      "Status flow is generated from the same table the server enforces, so if a move is not on that page the app refuses it — the page cannot be out of date with the rule.",
    ],
  },
  {
    q: "I want to know why my ticket went to a review queue",
    who: "Anyone",
    go: "matrix",
    steps: [
      "Below the tier floor → Pending Review - PSP first, then Pending Review - Head Sales. PSP settles whether the margin is survivable; the Sales Head then decides whether Sales will wear the concession. Where PSP does not take the ticket, it goes straight to the Sales Head and they are the only gate.",
      "Sales priced a Hypercare, Strategic or Must Win deal → Pending Review - Head PNS. That queue is the Head of PNS’s own oversight of the three watched groups, and nothing else lands in it.",
      "Sales priced anything else at or above Rp 30 Mio → Pending PNS, assigned like ordinary PNS work. It is still checked, just not by the Head.",
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
    q: "I want to take a ticket, hand one over, or put one back",
    who: "Anyone in PNS (PNS PIC) · a salesperson on their own ticket, or a Sales Manager or Head on any (Sales PIC)",
    go: null,
    steps: [
      "There is one PNS assignment — the PNS PIC — and it is the team's, not the Head's alone. Take this, Hand over and Put back sit on the Open, Awaiting price and watched-group lists as well as on the ticket, so you do not have to open a ticket to claim it.",
      "PSP has no PIC at all: it works one shared queue, and any PSP member may decide any ticket.",
      "Sales PIC: if the ticket is yours you can hand it to a colleague yourself. Moving somebody else's is a Sales Manager's or the Head's call, and a name nobody has registered is refused — notifications to them would go nowhere.",
      "Workload shows how loaded each PNS member is. The auto-assigner caps everyone at 10 tickets at Pending PNS; past that a ticket stays unassigned and the Head is notified, because an unassigned ticket is visible and an over-assigned one is not.",
      "Every list shows PNS unassigned in amber when nobody owns a ticket.",
    ],
  },
  {
    q: "Who checks a price Sales built, and is that PSP?",
    who: "Anyone",
    go: "review",
    steps: [
      "It is PNS, not PSP, and which PNS depends on the deal. Hypercare, Strategic and Must Win go to the Head of PNS, who finalises the solution AND its pricing — and that happens FIRST, before PSP, the Sales Head or C-level see it. Everything else Sales priced at or above Rp 30 Mio becomes ordinary Pending PNS work, assigned like any other job.",
      "PSP is a different question entirely: is this margin acceptable to the business. PSP never reviews the workings, only the number.",
      "There is no separate 'price reviewer' slot any more (retired 14 Aug 2026). One assignment, the PNS PIC, holds the ticket. If you want a second opinion, ask for it in the ticket's Discussion, where the answer is written down against the deal.",
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
    q: "Which fields must I fill in, and will Sales CRM overwrite my correction?",
    who: "Anyone",
    go: "fields",
    steps: [
      "Two different things get called “required” and telling them apart saves most of the confusion. The intake form marks about thirty fields required and nothing checks them afterwards — they are asked, not enforced. Only FIVE things actually stop a ticket, and Reference / Fields lists them first for that reason.",
      "The five: no Sales CRM opportunity id (parks in Pending CRM ID, cannot move at all); potential revenue 0 (cannot enter any working status or be priced); a go-live date with no account identifiers behind it; a Kick-off with a blank go-live or shipper ID; and a Standard deal priced below its floor.",
      "On syncing: Sales CRM OWNS the stage, deal name, Sales PIC, submitted date, Must Win, committed revenue, close date and lead source. Those are re-copied every morning, so a correction made here lasts until the next run — fix them in Sales CRM instead.",
      "Everything else it sends — volume, destination, pickup, contact, go-live — only fills a blank and never overwrites, so a correction you make here survives. Service line, potential revenue and account tier are never overwritten at all, because PNS corrects those deliberately.",
      "Fields is generated from the same tables the sync itself walks, so it cannot claim a field syncs when it does not.",
    ],
  },
  {
    q: "Sales said the deal has RDO — now what?",
    who: "Sales writes it, PNS prices it",
    go: "rdo",
    steps: [
      "“RDO: Yes” on its own is not something PNS can price against. What counts as a valid RDO is per deal, not one company-wide rule — every shipper wants something slightly different returned.",
      "So Sales writes it on the request: the RDO details from Sales field appears on the New Request form as soon as RDO is set to Yes. What the shipper wants returned, to whom, and how signed.",
      "The example photographs go on the ticket afterwards — Attachments, kind “RDO example from Sales”. They are labelled separately from goods photos so the RDO page can collect them across every deal.",
      "Reference / RDO lists every opportunity carrying RDO, filterable by region, and marks the ones tagged Yes with no details yet. That is the list to chase Sales on.",
    ],
  },
  {
    q: "The intake is wrong or half-empty — can I fix it?",
    who: "PNS, Commercial, Sales Planning or Admin",
    go: null,
    steps: [
      "Yes, all of it. Open the ticket, Input tab, Edit input. Most tickets arrive from the Sales CRM sync carrying only what Sales CRM knows, which is never the whole solutioning picture, so correcting somebody else's intake is normal work rather than an exception.",
      "Potential revenue and account type included. Those two used to be the Sales Head's alone because they re-route the ticket — but while PNS is the only team on the platform, leaving the fix with the one role that is not using the app meant you could see exactly what was wrong and not correct it. They go back to the Sales Head when Sales starts working its own queues.",
      "Correcting either re-runs the routing rule on the corrected facts, and the ticket says so: 'now priced by PNS' appears in the history with your name and the before/after. The status is deliberately left where it is — a correction should not yank a ticket out of the queue it is sitting in.",
      "A missing Sales CRM opportunity id is the same idea: it is a missing fact, not a decision, so anyone who can edit intake can supply it from the Pending CRM ID screen.",
      "A go-live date is the one thing that is refused until the account identifiers are filled in — it is a commitment to Ops, and Ops cannot act on a date without the IDs to onboard against.",
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
          in order (<b>Head PNS</b> for the three watched groups, <b>Head Sales</b> for a price
          below the floor, <b>PSP</b> for the margin, <b>C-level</b> for managed accounts,
          always last) → the proposal goes out → Sales records won or lost → the charter is
          published and Ops onboard. Everything else in this app is a way of seeing where a
          ticket currently sits in that line.
        </p>
      </Card>
    </>
  );
}
