import { Card, Head, Pill } from "../ui";

const ENTRIES = [
  {
    date: "2026-08-11",
    title: "Sales CRM becomes the system of record: CRM ID mandatory, Must Win, Open",
    by: "Baskoro + Claude",
    changes: [
      "The agreed process: Sales raise the opportunity in Sales CRM first, then either open the ticket here with its CRM ID or wait for the daily sync. A ticket raised here without a CRM ID parks in the new status Pending CRM ID and cannot move — the sync finds each deal by id, so a ticket it cannot see would drift out of step and be believed anyway. Its own screen collects the id and releases the ticket.",
      "The daily sync now treats Sales CRM as the priority on every run: stage, deal name, Sales PIC and Must Win are re-copied as they stand there. Service line, potential revenue and account tier are still left alone, because PNS corrects those here on purpose.",
      "New status Open: intake complete, nothing owed by Sales, and nobody has picked it up. Previously these sat in Pending PNS, which reads as 'someone is working on it' and hid the difference between work in progress and work nobody has started. Its screen offers exactly two moves — start work on it, or send it back to Sales with what is missing.",
      "Must Win joins the tiering as a third watched group, alongside Hypercare and Strategic. It sits on the OPPORTUNITY, not the account: the same account can have a must-win deal and five ordinary ones, so tagging the account would have promoted all of them. Hypercare and Strategic stay at account level, inherited from the parent group.",
      "Non-Strategic is renamed Standard — same tier, a name that says what it is rather than what it is not.",
      "Review - Head PNS is narrowed to the three watched groups. A Standard deal now goes straight to the shipper whatever its revenue; the old 'any Sales price at or above 30 Mio' rule was catching ordinary deals in volume and turning PNS review into a toll booth.",
      "Two dates instead of one. Submitted is now Sales CRM's own date (its new_date, the day the opportunity was raised) and is corrected on every refresh; First synced is the day this app first saw the deal, written once and never revised. Before this, an imported ticket claimed it arrived the day somebody ran the sync, so weeks of pipeline age disappeared — one deal checked in Sales CRM was raised on 14 July and would have shown as 12 August.",
      "Must Win is read from Sales CRM's Lead Source Detail field, where the value is literally 'Must Win' — it is not a field of its own. It can also be set by hand on the ticket for a deal Sales has not tagged there yet; a later sync overwrites that, because Sales CRM is the record.",
      "Every ticket shows which Sales CRM records it is tied to — the opportunity (the deal, where Must Win and the stage live) and the account (which sets the tier, inherited from the parent group) — each with a link straight into Sales CRM.",
    ],
    overruled: [
      "PNS review was triggered by revenue (Sales-priced at or above Rp 30 Mio). It is now triggered by group membership: Hypercare, Strategic or Must Win.",
      "A ticket could be raised here with no link to Sales CRM at all. Now it can be raised, but not progressed.",
      "'Non-Strategic' as a tier name.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Reconciled: Michael's PSP work and Baskoro's .30/.31 are both in .32",
    by: "Baskoro + Michael + Claude",
    changes: [
      "The two clones had diverged. Michael's three commits (PSP entry gate on the forward path, Escalate as a button, PSP entering pricing while deciding, the edit-input go-live fix, rate-card links, Hypercare in the New Request dropdown) were in GitHub but not in the live .31. Baskoro's .29/.30/.31 were live but not in GitHub. Both are now merged into .32 and pushed; neither side was dropped.",
      "Michael's new code paths were renamed onto the new status vocabulary as part of the merge, so Escalate and Send to PSP both target Pending Review - PSP.",
      "From now on a change is previewed locally against a mock API before it is deployed, and the branch is compared against GitHub first. The .31 deploy overwrote Michael's live build because neither check was run.",
    ],
    overruled: [
      "ask_psp on POST .../price stays retired, as Michael decided — escalation goes only through POST .../status, where the gate is now enforced. The Escalate checkbox added on the Baskoro side is replaced by his button.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Review statuses renamed, sync closes tickets, PNS pilot, in-app guide",
    by: "Baskoro + Claude",
    changes: [
      "The four review statuses are renamed to say who owes the decision: Pending Review - Head PNS, Pending Review - Head Sales, Pending Review - PSP, Pending Review - C-level. Existing tickets and their history were renamed with them, so the timeline reads in today's vocabulary.",
      "The Sales CRM sync now moves our status when the opportunity closes there. Closed-Lost and Future Opportunity become Lost (reason: closed in Sales CRM); the accepted stages become Ready to Ship. If the ticket's onboarding fields are still blank when that happens, PNS and Sales are notified with the exact list of what is missing.",
      "The sync screen has explicit modes. 'Re-check held tickets only' ignores dates entirely and re-reads every opportunity behind a ticket you hold — this is how you find deals that closed in Sales CRM after they were imported. The day window has always been the opportunity's creation date, never its last edit; the screen now says so.",
      "Account tier (Hypercare / Strategic / Non-Strategic) filters on the dashboard with counts, and is colour-coded in the table. It decides routing, pricing ceilings, PSP entry and exec sign-off, so it sits beside status rather than hiding.",
      "PNS pilot: while the tool runs inside PNS before Sales is onboarded, PNS can attach prices on Sales-owed tickets including below the floor, and the PNS Head can acknowledge in the Sales Head's place. Set PNS_PILOT=0 in the portal the day Sales starts working its own queues and every rule snaps back with no deploy.",
      "New 'How do I…' screen under Reference: every flow written as the thing you are trying to do, with a button that takes you to the right screen. Open to everyone.",
      "The intake and charter now separate Kick-off from Charter. Sections 1-3 are solutioning; section 4 holds go-live and the account-system IDs Ops needs to onboard.",
      "Reopening a lost or cancelled deal is any salesperson's to do, not only the Sales Head.",
      "The PSP exception card gained 'Open & send now', so recording Alex's exception and sending the ticket to PSP is one step when you mean both.",
      "Shipper names are no longer truncated in the dashboard table — the part that told two tickets apart was the part being cut off.",
    ],
    overruled: [
      "The old status names (Pending PNS Review, Pending Head Review, Pending PSP Approval, Pending Exec Sign-off) are gone. Same gates, named for who decides.",
      "The sync was strictly one-way for status: it copied the Sales CRM stage but never acted on it, and status_for_stage() was dead code. Baskoro's call is that a closed opportunity closes our ticket, with a flag when required fields are blank.",
      "Reopen was Commercial Head only.",
      "Pricing was strictly the responsible side's. PNS covers both during the pilot only.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Open visibility, global search, phases and the Sales Manager tier",
    by: "Baskoro + Claude",
    changes: [
      "Everyone signed in can now browse every queue — active, pending and closed. What stays gated per role is acting: the buttons inside each screen, which the backend refuses anyway. Cost and margin stay restricted to PNS, PSP and CSO.",
      "A search bar sits in the header on every screen. It finds tickets by reference, shipper or Sales CRM opportunity id, and also jumps to any view — type 'psp' or 'sales' and pick the screen. Press / to focus it.",
      "The PSP queues moved into the Solutioning menu, tagged PSP — margin approval is a step of solutioning, not a separate pipeline.",
      "Every queue carries the same filter bar, with a PNS PIC dropdown and an 'Assigned to me' toggle, so PNS members can narrow any list to their own assignment in one click.",
      "The dashboard breaks the book down by phase — Being worked, In approval, With shipper, Won, Lost — instead of only won and lost. Each phase tile is a click-to-filter. A 'Waiting on me' tile shows how many of your own tickets still need a move.",
      "Tickets can be filtered by Sales CRM stage on the dashboard. The stage is reference data from the sync; it is not this app's status and never overwrites it.",
      "The PNS Head can now delete a ticket to the recycle bin, and restore from it. Erasing permanently from the bin stays Admin only.",
      "New Sales Manager tier (Commercial only): a Sales Manager can reassign the Sales PIC on a ticket, exactly like the Sales Head, and nothing else beyond staff.",
      "The PNS assignment is stated on every ticket card and on the ticket header even when empty — 'PNS unassigned' in amber, because an unowned ticket is a fact people must see.",
      "The count badge next to a menu entry is the number of tickets sitting in that status. One ticket in Proposal Submitted reads as 'Proposal submitted · 1' — the 1 is a live count, not part of the name.",
    ],
    overruled: [
      "Legal was scoped to accepted deals only when browsing. Baskoro opened visibility to every role; Legal still cannot act on anything.",
      "Delete to the recycle bin was Admin only. The PNS Head has it too now; permanent erase stays Admin.",
      "Sales PIC reassignment was Commercial Head only. The new Sales Manager tier shares it.",
    ],
  },
  {
    date: "2026-08-11",
    title: "The .30 collision had a real casualty: SOF-2001322 vanished from PSP — Pending",
    by: "Michael + Claude",
    changes: [
      "Baskoro's overwritten .29/.30 used \"Pending Review - PSP\" as the status a ticket carries once sent to PSP. This build has always used \"Pending PSP Approval\". Deploying over his version fixed the code but not data already written with his string, so SOF-2001322 (PT Supa Surya Niaga) sat under a status nothing in the running app matched, and stopped appearing in PSP — Pending with no error, no deletion, nothing to see. Reported by Michael, traced from a screenshot of the ticket's own status pill, not found by any test in tests/.",
      "V20 corrects that one confirmed ticket. status_since is left alone, this is a label fix, not a real transition.",
      "Administration now has an Orphaned ticket status check: any ticket whose status isn't one the running code recognises, found without guessing what an unfamiliar value should become. Baskoro's unpushed build may have touched other statuses the same way; this is how to find them instead of waiting for someone to notice a ticket went quiet.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "PSP can enter pricing on the ticket they're deciding, not just approve or reject",
    by: "Michael + Claude",
    changes: [
      "PSP — Pending now has link, label, margin and discount fields, submitted in the same action as Approve or Reject. Left blank, PSP decides on whatever is already attached, unchanged. A ticket reaches PSP precisely because someone else could not price it as often as it reaches PSP to check someone else's number, and there was no way to enter the first case without a separate trip through Awaiting price.",
      "Confirmed and left alone: for a managed account (Strategic/Hypercare), both Approve and Reject already returned the ticket to whoever priced it (Pending PNS or Pending Sales) — Approve does it via psp_ready and an explicit Submit proposal, Reject via the normal re-quote path. That part was already correct.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "Deploy collision: Baskoro's live .30 was not in GitHub and got overwritten",
    by: "Michael + Claude",
    changes: [
      "Before this deploy, the live app reported build 2026-08-11.30. The newest commit in GitHub at that point was 5e163d3 (2026-08-10.28). .29 and .30 were deployed directly and never pushed, so this repo has no record of what changed in them.",
      "Michael chose to deploy anyway rather than wait, knowing this overwrites .30 on the live app. This entry exists so that choice, and what it cost, is written down rather than silently lost — the live build number will read lower after this deploy than it did before, which is the visible sign something upstream of it was never in git.",
      "If you are Baskoro reading this: whatever .29/.30 did on your machine still exists there. Push it as its own commit against current main so it can be reconciled and re-applied, rather than redone from memory.",
    ],
    overruled: [],
  },
  {
    date: "2026-08-11",
    title: "PSP entry gate closed on the forward path, Escalate as a button",
    by: "Michael + Claude",
    changes: [
      "The PSP entry gate is now also enforced on POST .../status, not only on submit_price. That endpoint is what both Escalate to PSP and Send to PSP (mid-review) actually call, and it had no may_go_to_psp check at all, so either button could route any ticket to PSP with no exception recorded, the exact thing the gate exists to stop.",
      "Escalate to PSP is a button, not a checkbox bundled into Attach price. It acts immediately, independent of whether a price is entered yet, so the ticket appears on PSP's Pending queue the moment it's clicked instead of only once someone also finishes and submits the price form.",
      "Fixed edit-input save failing on unrelated changes: the missing-onboarding-IDs check read the merged payload, so a ticket that already had a go-live date (nearly every ticket the New Request form creates, since Sales CRM imports one too) failed to save any edit at all, a typo in the brief included, until Parent shipper ID, Shipper ID and Corporate branch ID were also filled in. It now only fires when go-live is part of the edit being made.",
      "LTL and B2BR rate cards link to the pricing tool (web-pricing.ninjavan.apps.substrait.build), on Awaiting Price and in the ticket's Pricing tab.",
      "Hypercare added to the New Request account-type dropdown: Hypercare, Strategic, Non-Strategic.",
    ],
    overruled: [
      "The Escalate-to-PSP checkbox on Attach price, and ask_psp on POST .../price, are retired. Escalating now goes only through POST .../status, the same endpoint Send to PSP already used. Two endpoints doing the same discretionary-PSP job, gated separately, is how the gate ended up enforced on one and not the other.",
    ],
  },
  {
    date: "2026-08-10",
    title: "Importer, assignment and sync sizing",
    by: "Baskoro + Claude",
    changes: [
      "Trucking opportunities are imported instead of held back. Sales CRM cannot say whether they are FTL on-call or FTL monthly, so they land as on-call with a note and a flag for Sales to confirm before the charter goes out. Safe as a provisional label, since both FTL lines route to PNS and carry the same ceilings.",
      "Complex Logistics assignment now splits on the account rather than on load. A new account goes to Michael Quinn; an account already shipping goes to Adila. Sameday is Annisa's exclusively from intake to published charter.",
      "PNS can edit intake. During the Sales CRM rollout most intake arrives imported and incomplete, and waiting on Sales to complete it would stall the solutioning it exists to feed.",
      "The sync sizes itself. It reads from the newest opportunity and stops once it reaches ones already imported, so a routine run reads a single page. The page count is now only a ceiling for a first import or a long gap.",
      "Accounts for a page are fetched concurrently. Sequentially it was up to 200 round trips before the first ticket was considered, which ran past the ingress timeout and returned an empty 502.",
      "A sweep that runs out of time now returns what it has and says so, rather than being cut off with no explanation.",
    ],
    overruled: [
      "Trucking was being skipped entirely to avoid guessing the FTL line. Holding the work back cost more than a provisional label that gets corrected.",
      "Intake was Sales and Sales Planning only. PNS is added for the rollout period.",
      "The sync asked how many pages to read. It now works that out itself.",
    ],
  },
  {
    date: "2026-08-10",
    title: "PSP entry gate",
    by: "Baskoro + Claude",
    changes: [
      "Three routes reach PSP on the rule itself: a Sameday discount over 20 percent, either FTL line at or above Rp 30 Mio, and any Hypercare or Strategic account.",
      "The discretionary routes are gated instead. A below-bottom price the Sales Head has acknowledged, and the optional Escalate to PSP checkbox, only continue to PSP where Alex (CSO) has granted an exception.",
      "Strategic and Hypercare carry that exception by being managed. Any other ticket needs the PNS Head to open it, recording what Alex granted and where. The note is mandatory.",
      "A below-bottom price on a ticket with no exception now ends with the Sales Head, who is the sign-off rather than a step on the way to PSP.",
    ],
    overruled: [
      "Every below-bottom price was going to PSP after the Sales Head acknowledged it. That sent deals to PSP that carry no exception, which is not what PSP reviews.",
      "The gate was then applied too widely, which would have diverted Sameday over 20 percent and FTL at or above 30 Mio away from PSP. Those are PSP's by rule and were restored.",
      "The optional Escalate to PSP checkbox was open to anyone on any service. It now follows the exception gate.",
    ],
  },
  {
    date: "2026-08-10",
    title: "Sales CRM sync, approvals and field comments",
    by: "Baskoro + Claude",
    changes: [
      "Sales CRM sync: manual, dry run by default, restricted to one named owner. Creates tickets for new opportunities and refreshes stage, committed revenue and close date on ones already imported.",
      "Pricing ceilings from the four 5A tables, checked automatically when a price is attached, per service and per revenue band.",
      "Routing fix: service is tested before revenue, so FTL monthly and Sameday reach PNS at every band. Previously they were handed to Sales above 30 Mio.",
      "Hypercare added as a third account tier, alongside Strategic and Non-Strategic.",
      "Executive sign-off gate for Hypercare and Strategic solutions, Alex and Dhinesh, always last.",
      "Project Charter can be emailed to Legal, Sales Admin and the sales PIC.",
      "Comments can be attached to a single intake field, with a recap into the main thread.",
      "PNS assignment by service line, capped at 10 tickets each. Past the cap a ticket stays unassigned and the Head is told.",
      "QC becomes a role group and owns CAPA closure. Legal, Finance and Visitor are view only. Sales Planning may correct intake.",
      "Status filter grouped by who is acting, with counts.",
    ],
    overruled: [
      "Global ID field removed. The shipper ID is the global shipper id, one number under one name.",
      "Below-bottom was going to be fully automatic. Michael's manual checkbox is kept alongside the computed guard, so both run.",
      "Sales Head was going to be the final acknowledger for a margin breach. Michael's flow wins: the Sales Head acknowledges, then PSP signs off. More oversight, and it is what production already does.",
    ],
  },
  {
    date: "2026-08-10",
    title: "PSP queue and mandatory margin review",
    by: "Michael",
    changes: [
      "PSP gets its own Pending and Finished queues, plus a PIC per ticket.",
      "Below-bottom prices go to the Sales Head to acknowledge, then to PSP for a mandatory margin sign-off.",
      "Optional Escalate to PSP checkbox for a second opinion on any service.",
      "After PSP approves a price that needed no PNS review, the ticket returns to whoever priced it for an explicit final submit.",
      "Bottom margin narrowed to the two services with a published floor, LTL 5 percent and B2BR 10 percent.",
    ],
    overruled: [
      "The Awaiting Price form had stopped collecting margin. It collects margin and discount again, because the 5A tier ceilings need both to check anything.",
    ],
  },
  {
    date: "2026-08-08",
    title: "Waiting times, copyable charter, CAPA attachments",
    by: "Michael",
    changes: [
      "Pickup and delivery waiting times added to the intake.",
      "Project Charter can be copied as a formatted table for pasting into email.",
      "CAPA supports file attachments.",
    ],
    overruled: [],
  },
];

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Entry({ entry }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold">{entry.title}</h2>
          <p className="text-[12px] text-slate-500">{entry.date} &middot; {entry.by}</p>
        </div>
        {entry.overruled.length > 0 && (
          <Pill tone="bg-rose-50 text-rose-700">
            {entry.overruled.length} overruled
          </Pill>
        )}
      </div>

      <Table
        head={["#", "What changed"]}
        rows={entry.changes.map((c, i) => [
          <span className="font-mono tabular-nums text-slate-400">{i + 1}</span>,
          c,
        ])}
      />

      {entry.overruled.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-2 text-[12px] font-semibold text-slate-600">
            Overruled by this release
          </p>
          <Table
            head={["", "What was decided instead"]}
            rows={entry.overruled.map((o) => [
              <Pill tone="bg-rose-50 text-rose-700">overruled</Pill>,
              o,
            ])}
          />
        </div>
      )}
    </Card>
  );
}

export default function Changelog() {
  return (
    <>
      <Head title="Changelog"
        sub="Read-only. Newest first."
        right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{ENTRIES.length} entries</span>} />

      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-slate-600">
        Two people ship to this app, and a decision one makes can quietly undo the other&rsquo;s.
        This screen records what went in and, where the two streams disagreed, which call was
        overruled and what stands instead.
      </p>

      {/* The rule is stated in the app because this is the page both people actually open.
          It is repeated in CHANGELOG.md for whoever is reading the repo instead. */}
      <div className="mb-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-[12.5px] font-semibold text-amber-900">
          Every change to this app gets an entry here.
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-amber-800">
          Add it in the same commit as the change, at the top of the <code>ENTRIES</code>{" "}
          array in <code>frontend/src/screens/Changelog.jsx</code>. If your change reverses
          or narrows something the other person built, it belongs under{" "}
          <b>overruled</b>, not under what changed. An overruled decision that goes
          unrecorded is how the same argument gets had twice.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {ENTRIES.map((e) => <Entry key={e.date + e.title} entry={e} />)}
      </div>
    </>
  );
}

// New entries go at the top of ENTRIES.
