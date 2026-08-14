import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Head, Pill } from "../ui";

// "Which fields must be filled for a ticket to move, and which come from Sales CRM?"
// Both were answerable only by reading main.py, which means both were unanswerable.
//
// The page keeps two things apart that are constantly confused:
//
//   ENFORCED  the server refuses. There are five, and they are the whole reason a ticket
//             ever gets stuck.
//   ASKED     the form marks it required and nothing checks it afterwards. Most fields.
//
// Calling both "required" would bury the five that actually block among the thirty that
// do not — which is exactly the state this page exists to end.

const WHEN = {
  enforced: ["Blocks the ticket", "bg-rose-50 text-rose-700"],
  asked: ["Asked at intake", "bg-slate-100 text-slate-600"],
  won: ["Needed once won", "bg-amber-50 text-amber-700"],
  optional: ["Optional", "bg-slate-50 text-slate-400"],
};

const SYNC = {
  overwritten: ["Sales CRM owns it", "bg-sky-50 text-sky-700",
    "Re-copied on every sync. A correction made here is overwritten — fix it in Sales CRM."],
  "gap-fill": ["Fills a blank only", "bg-emerald-50 text-emerald-700",
    "The sync fills it while ours is empty and never overwrites it, so a correction here survives."],
  never: ["Never synced", "bg-slate-100 text-slate-500",
    "Sales CRM does not carry it. It is only ever what somebody typed here."],
};

function Legend({ map, title }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div className="flex flex-col gap-1.5">
        {Object.entries(map).map(([k, [label, tone, why]]) => (
          <div key={k} className="flex items-start gap-2 text-[12px]">
            <Pill tone={tone}>{label}</Pill>
            {why && <span className="text-slate-500">{why}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Rows({ fields }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            {["Field", "Who fills it", "When", "From Sales CRM", "What it blocks"].map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const [wLabel, wTone] = WHEN[f.when] || WHEN.asked;
            const [sLabel, sTone] = SYNC[f.sync] || SYNC.never;
            return (
              <tr key={f.key} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="font-medium">{f.label}</div>
                  <code className="font-mono text-[11px] text-slate-400">{f.key}</code>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{f.who}</td>
                <td className="px-4 py-3"><Pill tone={wTone}>{wLabel}</Pill></td>
                <td className="px-4 py-3">
                  <Pill tone={sTone}>{sLabel}</Pill>
                  {f.crm_fields.length > 0 && (
                    <div className="mt-1 font-mono text-[10.5px] text-slate-400">
                      {f.crm_fields.join(", ")}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{f.blocks || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Fields() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.fieldGuide().then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <Card className="border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>;
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;

  const sections = [...new Set(d.fields.map((f) => f.section))];

  return (
    <>
      <Head title="Fields"
        sub="What every field is for, who fills it, whether it stops the ticket, and whether Sales CRM overwrites it. Generated from the same tables the sync walks, so it cannot claim a field syncs when it does not." />

      {/* The five gates first. This is the answer to "why is this stuck", and nobody
          should have to find it inside a forty-row table. */}
      <Card className="mb-4">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">
            The only five places the app says no
          </h2>
          <p className="text-[12px] text-slate-500">
            Everything else the intake asks for is asked, not enforced. If a ticket will
            not move, it is one of these.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                {["What is missing", "What stops", "How to fix it"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.gates.map((g, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{g.what}</td>
                  <td className="px-4 py-3 text-slate-600">{g.stops}</td>
                  <td className="px-4 py-3 text-slate-600">{g.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-4 grid grid-cols-1 gap-5 p-4 sm:grid-cols-2">
        <Legend title="When it is needed" map={WHEN} />
        <Legend title="Where it comes from" map={SYNC} />
      </Card>

      {/* Sales CRM's own columns, said once and plainly. This surprises people exactly
          once, expensively — usually after they have corrected the same field twice. */}
      <Card className="mb-4 border-l-4 border-l-sky-400 bg-sky-50/40 p-4">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-sky-700">
          Corrections that will not survive the next sync
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
          Sales CRM is the system of record for {d.crm_owned_columns.join(", ")}. Those
          are re-copied on every run, so correcting one here lasts until the morning.
          Fix them in Sales CRM. Everything else is either filled only while ours is
          blank, or never touched at all.
        </p>
      </Card>

      <Card className="mb-4">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">On the ticket</h2>
          <p className="text-[12px] text-slate-500">
            The facts that decide routing and pricing. Four of the five gates are here.
          </p>
        </div>
        <Rows fields={d.ticket_fields} />
      </Card>

      <div className="flex flex-col gap-4">
        {sections.map((sec) => (
          <Card key={sec}>
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">{sec}</h2>
            </div>
            <Rows fields={d.fields.filter((f) => f.section === sec)} />
          </Card>
        ))}
      </div>
    </>
  );
}
