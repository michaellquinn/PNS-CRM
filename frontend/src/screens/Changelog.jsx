import { Card, Head, Pill } from "../ui";

const ENTRIES = [
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
