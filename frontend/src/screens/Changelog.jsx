import { Card, Head, Pill } from "../ui";

const ENTRIES = [
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
      "The discretionary routes are gated instead. A below-bottom price the Sales Head has acknowledged, and the optional Escalate to PSP checkbox, only continue to PSP where Alex (CSalesO) has granted an exception.",
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
