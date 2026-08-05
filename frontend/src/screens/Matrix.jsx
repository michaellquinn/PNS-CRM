import { Card, Head, Pill } from "../ui";

const ROUTING = [
  ["Strategic", "any service", "any revenue", "PNS", "no"],
  ["Non-Strategic", "any service", "≥ Rp 30 Mio", "Sales", "yes — PNS reviews before it goes out"],
  ["Non-Strategic", "FTL monthly / Sameday", "< Rp 30 Mio", "PNS", "no"],
  ["Non-Strategic", "LTL / B2BR / B2C / FTL on-call", "< Rp 30 Mio", "Sales", "no"],
];

const LADDER = [
  ["< Rp 30 Mio", "Standard only", "Published rate card. No deviation.", "—"],
  ["Rp 30–100 Mio", "Light customization", "Time slot, packaging, reporting cadence.", "PNS review"],
  ["Rp 100–500 Mio", "Moderate", "Dedicated route, DWS handling, custom SLA.", "PNS + PSP"],
  ["> Rp 500 Mio", "Full", "Dedicated fleet, hub space, bespoke integration.", "PNS + PSP + Head"],
];

const OWED = [
  ["Pending PNS", "The assigned PNS owner", "PNS Head, so they can assign someone"],
  ["Pending PNS Review", "The assigned reviewer", "The PNS owner, then the PNS Head"],
  ["Pending Sales", "The sales PIC", "Commercial Head"],
  ["Pending Vendor", "The assigned PNS owner", "PNS Head"],
  ["Pending PSP Approval", "Everyone in PSP", "—"],
  ["Pending Head Review", "Head of the team that priced it", "Admin"],
];

const APPROVAL = [
  ["Within rate card", "Nobody — attach and go", "—"],
  ["Discount inside the tier", "Priced-by team", "—"],
  ["Below product bottom rate", "Head of the team that priced it", "Pending Head Review"],
  ["Margin needs sign-off", "PSP", "Pending PSP Approval"],
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
        sub="The rules the tool enforces. Read-only — changes go through the PRD, not the app."
        right={<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">v1.0</span>} />

      <div className="flex flex-col gap-4">
        <Block title="1 · Who owns the ticket"
          sub="Applied at submission, in this order. The first match wins.">
          <Table head={["Account type", "Service", "Potential revenue", "Prices it", "PNS review"]}
            rows={ROUTING} align={{ 4: "text-slate-600" }} />
        </Block>

        <Block title="2 · How much customization the revenue buys"
          sub="Ask for more than the tier allows and it comes back — the tier is the cap, not a target.">
          <Table head={["Potential revenue", "Level", "What's on the table", "Sign-off"]} rows={LADDER} />
        </Block>

        <Block title="3 · Price approval"
          sub="Cost and margin stay with PNS, PSP and CSO. Nothing on the Project Charter carries them.">
          <Table head={["Situation", "Who approves", "Status it enters"]} rows={APPROVAL} />
        </Block>

        <Block title="4 · Who gets told when a ticket comes back"
          sub="A pending status is a queue, and queues get watched by nobody in particular. Every send-back and rejection lands on a named person — never on silence.">
          <Table head={["Ticket moves to", "Notified", "If that slot is empty"]} rows={OWED} />
        </Block>

        <Block title="5 · Known gaps"
          sub="Carried from the PRD's open dependencies — these are decisions still outstanding.">
          <ul className="list-disc space-y-1.5 px-8 py-4 text-[13px] text-slate-600">
            <li>Sameday has no published product bottom margin, so "below bottom rate" can't be
                checked automatically for it — the flag is manual.</li>
            <li>The LTL rate card is marked Commercial Head + PNS only, yet Sales prices LTL
                under Rp 30 Mio. Access needs widening or the routing needs changing.</li>
            <li>CAPA has no revenue tier, so sections 1–3 above don't apply to it.</li>
            <li>Declared vs. DWS weights differ by roughly 20% — billing basis is still open.</li>
          </ul>
        </Block>
      </div>
    </>
  );
}
