import { useEffect, useState } from "react";
import { api, groupTone, rp } from "../api";
import { Btn, Card, Empty, Head, Pill } from "../ui";

// RDO is a 5A customization lever, and it is the one Commercial most often says yes to
// without anyone downstream seeing it until pricing. Two jobs on one page:
//
//   1. Every live opportunity where the intake says RDO = Yes, so PNS can see the whole
//      set at once instead of finding them one ticket at a time.
//   2. What RDO means inside the rules — which tiers may have it, and what it changes.
//
// What counts as a VALID RDO is per deal, not one company-wide rule: every shipper wants
// something slightly different returned. So it comes from Sales on the request itself —
// the rdoNotes field, plus example photos attached as kind "rdo_evidence" — and this
// page shows both, and names the deals where PNS has been told there is RDO and not told
// what it is.

const REGIONS = ["GJ", "WJ", "CJ", "EJ"];

// The 5A customization matrix bands, same ones the pricing ceiling uses. RDO's own row
// is not published in anything this app can read, so the page states the tier pattern
// that IS known and says plainly that the per-product row has to come from 5A.
const TIERS = [
  ["Hypercare / Strategic", "Manual review",
   "Managed accounts are manual review on every lever at every band, RDO included."],
  ["Standard, ≥ Rp 30 Mio", "Generally allowed",
   "The top band is where customization opens up."],
  ["Standard, Rp 10–30 Mio", "Check 5A",
   "The middle band varies by product — this is the row to confirm before promising it."],
  ["Standard, ≤ Rp 10 Mio", "Generally not",
   "The bottom band is locked to standard, with a 20% margin or discount floor."],
];

export default function Rdo({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [region, setRegion] = useState("");

  useEffect(() => {
    setRows(null);
    api.tickets({ rdo: true, region: region || undefined })
      .then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  }, [region]);

  const live = (rows || []).filter(
    (t) => !["Lost", "Cancel"].includes(t.status));

  return (
    <>
      <Head title="RDO"
        sub="Every opportunity Commercial has said carries RDO, and where RDO sits in the pricing rules."
        right={rows && (
          <span className="text-[12px] text-slate-500">
            {live.length} live of {rows.length}
          </span>
        )} />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          Region
        </span>
        <Btn onClick={() => setRegion("")}
          className={region === "" ? "border-[#EE1B2C] text-[#EE1B2C]" : ""}>
          All
        </Btn>
        {REGIONS.map((r) => (
          <Btn key={r} onClick={() => setRegion(r)}
            className={region === r ? "border-[#EE1B2C] text-[#EE1B2C]" : ""}>
            {r}
          </Btn>
        ))}
      </Card>

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}
      {rows === null && !err && <p className="text-sm text-slate-400">Loading…</p>}

      {rows && (
        <Card className="mb-4">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">Opportunities with RDO</h2>
            <p className="text-[12px] text-slate-500">
              Read from the intake field Commercial fills in. Decided deals are listed
              too, greyed, because what was agreed on a won deal is the precedent
              somebody will quote back at you.
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              Nothing carries RDO{region ? ` in ${region}` : ""}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                    {["Ticket", "Shipper", "Service", "Tier", "Revenue", "Region",
                      "Status", "From Sales"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const done = ["Lost", "Cancel"].includes(t.status);
                    return (
                      <tr key={t.ref}
                        className={`border-t border-slate-100 ${done ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3">
                          <button onClick={() => onOpen(t.ref)}
                            className="font-mono text-[12.5px] font-bold text-[#EE1B2C] hover:underline">
                            {t.ref}
                          </button>
                        </td>
                        <td className="px-4 py-3">{t.shipper}</td>
                        <td className="px-4 py-3 text-slate-600">{t.service}</td>
                        <td className="px-4 py-3">
                          {t.group
                            ? <Pill tone={groupTone(t.group)}>{t.group}</Pill>
                            : <span className="text-slate-500">Standard</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{rp(t.revenue)}</td>
                        <td className="px-4 py-3 text-slate-500">{t.region}</td>
                        <td className="px-4 py-3"><Pill dot>{t.status}</Pill></td>
                        {/* The point of the column: RDO = Yes on its own is not enough
                            to price against. This says whether Sales has actually said
                            what the RDO is, and attached an example. */}
                        <td className="px-4 py-3">
                          {t.input?.rdoNotes
                            ? <Pill tone="bg-emerald-50 text-emerald-700">details given</Pill>
                            : <Pill tone="bg-amber-50 text-amber-700">no details yet</Pill>}
                          {t.input?.rdoFiles
                            ? <span className="ml-1.5 text-[11.5px] text-slate-500">
                                {t.input.rdoFiles} example{t.input.rdoFiles === "1" ? "" : "s"}
                              </span>
                            : <span className="ml-1.5 text-[11.5px] text-slate-400">no examples</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* What Sales actually wrote, in full. The table above says whether it exists;
          this is the thing PNS has to price against, so it gets room to be read. */}
      {(rows || []).some((t) => t.input?.rdoNotes) && (
        <Card className="mb-4">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">What Sales said the RDO is</h2>
            <p className="text-[12px] text-slate-500">
              Straight from the request. Example photographs are attached to each ticket
              under <b>Attachments → RDO example from Sales</b>.
            </p>
          </div>
          <div className="px-4 py-2">
            {(rows || []).filter((t) => t.input?.rdoNotes).map((t) => (
              <div key={t.ref} className="border-b border-slate-100 py-3 last:border-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <button onClick={() => onOpen(t.ref)}
                    className="font-mono text-[12.5px] font-bold text-[#EE1B2C] hover:underline">
                    {t.ref}
                  </button>
                  <b className="text-[13px]">{t.shipper}</b>
                  <span className="text-[12px] text-slate-500">{t.service}</span>
                  {t.input?.rdoFiles && (
                    <Pill tone="bg-slate-100 text-slate-600">
                      {t.input.rdoFiles} example{t.input.rdoFiles === "1" ? "" : "s"} attached
                    </Pill>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                  {t.input.rdoNotes}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Where RDO sits in the rules</h2>
          <p className="text-[12px] text-slate-500">
            RDO is one of the 5A customization levers, alongside SLA customization,
            blended rate, packaging, billing basis, COD ongkir, TOP and drop points. Each
            lever is Yes / No / Manual review per product and revenue band.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {["Tier", "RDO", "Why"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIERS.map(([tier, verdict, why]) => (
                <tr key={tier} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{tier}</td>
                  <td className="whitespace-nowrap px-4 py-3">{verdict}</td>
                  <td className="px-4 py-3 text-slate-600">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-l-4 border-l-slate-300 p-4">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
          Where the acceptance criteria come from
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">
          Per deal, from Sales — not from a single company-wide rule. Every shipper wants
          something slightly different returned, so what counts as a valid RDO is stated
          on the request itself: the <b>RDO details from Sales</b> field, plus example
          photographs attached to the ticket as <b>RDO example from Sales</b>. Both show
          up here as soon as they exist.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
          A deal marked <b>no details yet</b> above is one PNS has been told has RDO and
          not told what the RDO is. That is the list to chase.
        </p>
      </Card>

    </>
  );
}
