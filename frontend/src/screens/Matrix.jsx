import { Card, Head, Pill } from "../ui";

const ROUTING = [
  ["Hypercare / Strategic", "any service", "any revenue", "PNS", "no"],
  ["Non-Strategic", "FTL monthly / Sameday", "any revenue", "PNS", "no"],
  ["Non-Strategic", "LTL / B2BR / B2C / FTL on-call", "≥ Rp 30 Mio", "Sales", "yes — PNS reviews before it goes out"],
  ["Non-Strategic", "LTL / B2BR / B2C / FTL on-call", "< Rp 30 Mio", "Sales", "no"],
];

// The "Max. Discount / Min. Margin" row of each 5A Revenue & Customization table.
// Bands are 5A's own: =< 10 Mio, 10 < x < 30 Mio, >= 30 Mio.
const LADDER = [
  ["LTL", "Margin ≥ 20%", "Margin ≥ 5%", "Margin ≥ 5%"],
  ["B2BR / B2C", "Margin ≥ 20%", "Margin ≥ 10%", "Margin ≥ 10%"],
  ["FTL on-call", "Standard rate", "Standard rate", "Manual review"],
  ["FTL monthly", "Margin ≥ 15%", "Margin ≥ 10%", "Manual review"],
  ["Sameday", "Discount ≤ 20%", "Discount ≤ 20%", "Discount ≤ 20%"],
];

const OWED = [
  ["Pending PNS", "The assigned PNS owner", "PNS Head, so they can assign someone"],
  ["Pending PNS Review", "The assigned reviewer", "The PNS owner, then the PNS Head"],
  ["Pending Sales", "The sales PIC", "Commercial Head"],
  ["Pending Vendor", "The assigned PNS owner", "PNS Head"],
  ["Pending PSP Approval", "Everyone in PSP", "—"],
  ["Pending Head Review", "Head of the team that priced it", "Admin"],
];

// Some routes are PSP's by rule. The rest are discretionary, and there PSP only takes
// what Alex has granted an exception for.
const APPROVAL = [
  ["Inside the tier ceiling", "Nobody. Attach and go.", "—"],
  ["Sameday discount over 20%", "PSP, by rule.", "Pending PSP Approval"],
  ["Either FTL line at or above Rp 30 Mio", "PSP, by rule.", "Pending PSP Approval"],
  ["Hypercare or Strategic account", "PSP, by rule. Manual review at every band.",
   "Pending PSP Approval"],
  ["Margin below the tier floor", "Sales Head. Sales owns the concession.",
   "Pending Head Review"],
  ["Sales Head acknowledges a below-bottom price",
   "Ends there, unless the ticket carries a PSP exception, in which case PSP signs off.",
   "Proposal, or Pending PSP Approval"],
  ["Alex grants a one-off exception in a meeting",
   "PNS Head records it against that ticket, which opens PSP for that ticket only.",
   "Unlocks Pending PSP Approval"],
];

const PSP_AFTER = [
  ["Was already Pending PNS Review", "Proposal Submitted", "That review already covers it — PSP was consulted mid-review."],
  ["Still needs PNS review (Sales priced, ≥30 Mio)", "Pending PNS Review", "PSP clearing the margin doesn't stand in for the review this ticket already needed."],
  ["No review needed either way", "Back to whoever priced it — Pending PNS or Pending Sales", "PSP approving isn't the same as the proposal being ready. They confirm with a plain Submit — nothing about the price is re-entered."],
  ["Rejected", "Back to whoever priced it, to re-quote", "Same as any send-back."],
];

const BOTTOM_MARGIN = [
  ["LTL", "5%"],
  ["B2BR", "10%"],
  ["B2C, FTL on-call, FTL monthly, Sameday", "Not published — no below-bottom checkbox for these yet"],
];

const SAMEDAY_RATE = [
  ["Regular", "Rp 20.000 / 5kg"],
  ["Premium", "Rp 35.000 / 5kg"],
];

function Table({ head, rows, align }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            {head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-3 ${align?.[j] || ""}`}>
                  {c === "PNS" || c === "Sales" ? <Pill>{c}</Pill> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ title, sub, children }) {
  return (
    <Card>
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <p className="text-[12px] text-slate-500">{sub}</p>
      </div>
      {children}
    </Card>
  );
}

export default function Matrix() {
  return (
    <>
      <Head title="Routing &amp; limits"
        sub="The rules the tool enforces. Read-only: changes go through the PRD, not the app."
        right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">v1.0</span>} />

      <div className="flex flex-col gap-4">
        <Block title="1 · Who owns the ticket"
          sub="Applied at submission, in this order. The first match wins.">
          <Table head={["Account type", "Service", "Potential revenue", "Prices it", "PNS review"]}
            rows={ROUTING} align={{ 4: "text-slate-600" }} />
        </Block>

        <Block title="2 · The pricing ceiling for the tier"
          sub="Checked automatically when a price is attached. Hypercare and Strategic accounts are manual review at every band, whatever this table says.">
          <Table head={["Service", "≤ Rp 10 Mio", "Rp 10–30 Mio", "≥ Rp 30 Mio"]} rows={LADDER} />
        </Block>

        <Block title="3 · Price approval"
          sub="Cost and margin stay with PNS, PSP and CSO. Nothing on the Project Charter carries them.">
          <Table head={["Situation", "Who approves", "Status it enters"]} rows={APPROVAL} />
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[12px] font-semibold text-slate-600">
              Bottom margin — a manual flag, only offered where a floor is published
            </p>
            <Table head={["Service", "Floor"]} rows={BOTTOM_MARGIN} />
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[12px] font-semibold text-slate-600">
              Sameday base rate — no rate-card link, so the number is stated here
            </p>
            <Table head={["Tier", "Rate"]} rows={SAMEDAY_RATE} />
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[12px] font-semibold text-slate-600">
              After PSP decides
            </p>
            <Table head={["Where the ticket was", "Goes to", "Why"]} rows={PSP_AFTER} />
          </div>
        </Block>

        <Block title="4 · Who gets told when a ticket comes back"
          sub="A pending status is a queue, and queues get watched by nobody in particular. Every send-back and rejection lands on a named person.">
          <Table head={["Ticket moves to", "Notified", "If that slot is empty"]} rows={OWED} />
        </Block>

        <Block title="5 · Known gaps"
          sub="Open decisions carried from the PRD.">
          <ul className="list-disc space-y-1.5 px-8 py-4 text-[13px] text-slate-600">
            <li>Only LTL and B2BR have a published bottom margin, so only they show the
                below-bottom checkbox. Every service still has a 5A tier ceiling that is
                checked automatically, and Sameday is capped on discount rather than
                margin: over 20% goes to PSP.</li>
            <li>The LTL rate card is marked Commercial Head + PNS only, yet Sales prices LTL
                under Rp 30 Mio. Access needs widening or the routing needs changing.</li>
            <li>Sales CRM carries one "Trucking" product and cannot say whether a deal is
                FTL on-call or FTL monthly — yet the two route differently. Imported tickets
                land as on-call and need a human to correct them.</li>
            <li>CAPA has no revenue tier, so sections 1–3 above don't apply to it.</li>
            <li>Declared vs. DWS weights differ by roughly 20% — billing basis is still open.</li>
          </ul>
        </Block>
      </div>
    </>
  );
}
