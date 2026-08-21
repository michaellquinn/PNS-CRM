import { useEffect, useMemo, useState } from "react";
import { api, PENDING, groupTone, rp } from "../api";
import { Btn, Card, Head, MultiSelect, Pill } from "../ui";

// All pending, run by region. Pick the regions in the room, and both people lists — the
// salesperson who sold it and the PNS PIC holding it — narrow to whoever actually has
// deals there. Picking from all of Commercial when three of them cover your region is
// how a list ends up with somebody else's deals in it.

const REGIONS = ["GJ", "WJ", "CJ", "EJ"];

/* A multi-select that reads as a row of toggles rather than a <select multiple>, which
   nobody can operate without being told to hold ctrl. */
function Toggles({ options, value, onChange, empty = "Any" }) {
  const flip = (v) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onChange([])}
        className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
          value.length === 0
            ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
            : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
        {empty}
      </button>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => flip(o)}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
            value.includes(o)
              ? "border-[#EE1B2C] bg-[#EE1B2C] text-white"
              : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Line({ n, t, onOpen, right }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="w-7 shrink-0 font-mono text-[11px] text-slate-400">{n}.</span>
      <button onClick={() => onOpen(t.ref)}
        className="font-mono text-[13px] font-bold text-[#EE1B2C] hover:underline">
        {t.ref}
      </button>
      <b className="text-[13px]">{t.shipper}</b>
      <Pill dot>{t.status}</Pill>
      {t.group && <Pill tone={groupTone(t.group)}>{t.group}</Pill>}
      <span className="text-[12px] text-slate-500">{t.service} &middot; {rp(t.revenue)}</span>
      <span className="ml-auto text-[12px] text-slate-400">{right}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- all pending */
/* Was "Review meeting", and carried a Proposals-submitted block above the pending one.
   Renamed and cut back to the pending half (Michael, 2026-08-18): a submitted proposal
   is out with the shipper and has a queue of its own, so listing it here made the same
   tickets appear twice and the agenda read longer than the work actually was. */
export function ReviewMeeting({ onOpen }) {
  const [pend, setPend] = useState(null);
  const [regions, setRegions] = useState([]);
  // Salesperson and PNS PIC are multi-select dropdowns. Both halves of that matter:
  // dropdowns because a wrapping row of thirty name pills is what made this bar
  // unreadable, and multi-select because a review is run for the people in the room and
  // that is rarely one person (Michael, 2026-08-18 — this was briefly single-select and
  // that was the wrong trade). The panel is the same control the dashboards use.
  const [people, setPeople] = useState([]);
  const [owners_, setOwners] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setPend(null);
    api.tickets({ status: PENDING, region: regions.length ? regions : undefined })
      .then((d) => setPend(d.tickets))
      .catch((e) => setErr(e.message));
  }, [regions.join(",")]);

  const all = pend || [];

  // The salesperson list is derived from the tickets ALREADY narrowed to the chosen
  // regions, so it answers "who has deals in the room" rather than "who exists". There
  // is no region column on a user, and inventing one would be a second thing to keep in
  // step with reality.
  const sales = useMemo(
    () => [...new Set(all.map((t) => t.sales).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);

  // The PNS side of the same question. The list walks Sales' deals, but the answer to
  // "where is this one" is usually a PNS name, so it has to be narrowable by who is
  // holding it as well as by who sold it.
  const owners = useMemo(
    () => [...new Set(all.map((t) => t.owner).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);

  // Names picked for one region and then deselected with the region should not keep
  // filtering invisibly. Unassigned survives on purpose — it is not a name that can stop
  // being in the list.
  useEffect(() => {
    setPeople((p) => p.filter((n) => sales.includes(n)));
  }, [sales.join(",")]);
  useEffect(() => {
    setOwners((p) => p.filter((n) => n === "__unassigned__" || owners.includes(n)));
  }, [owners.join(",")]);

  const keep = (list) =>
    (list || []).filter((t) =>
      (!people.length || people.includes(t.sales))
      && (!owners_.length
          || owners_.some((o) => (o === "__unassigned__" ? !t.owner : t.owner === o))));

  let n = 0;
  const Block = ({ label, sub, list, tone }) => {
    const rows = keep(list);
    const byPerson = rows.reduce((acc, t) => {
      (acc[t.sales || "Unassigned"] ||= []).push(t);
      return acc;
    }, {});
    return (
      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-[13.5px] font-semibold">{label}</h3>
            <p className="text-[12px] text-slate-500">{sub}</p>
          </div>
          <Pill tone={tone}>{rows.length} to walk</Pill>
        </div>
        <div className="p-4">
          {rows.length === 0 && (
            <p className="text-center text-sm text-slate-400">Nothing here this week.</p>
          )}
          {Object.keys(byPerson).sort().map((person) => (
            <div key={person} className="mb-4 border-l-2 border-[#EE1B2C] pl-3.5 last:mb-0">
              <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                {person} &middot; {byPerson[person].length}
              </div>
              {byPerson[person].map((t) => {
                n += 1;
                return <Line key={t.ref} n={n} t={t} onOpen={onOpen}
                  right={`${t.region} · PNS ${t.owner || "unassigned"}`} />;
              })}
            </div>
          ))}
        </div>
      </Card>
    );
  };

  return (
    <>
      <Head title="All pending"
        sub="Everything still open, grouped by the salesperson who presents it. Walk it top to bottom. Proposals already submitted are not here — they are out with the shipper and have their own screen."
        right={<Btn onClick={() => window.print()}>Print list</Btn>} />

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}

      <Card className="mb-4 flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Region
          </span>
          <Toggles options={REGIONS} value={regions} onChange={setRegions} empty="All regions" />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2.5">
            <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              Salesperson
            </span>
            {sales.length === 0 ? (
              <span className="text-[12.5px] text-slate-400">
                {pend === null ? "Loading…" : "Nobody has a live deal in those regions."}
              </span>
            ) : (
              <MultiSelect label="Salesperson" picked={people}
                onClear={() => setPeople([])}
                sections={[{ label: null, items: sales.map((s) => ({
                  key: s, label: s, on: people.includes(s),
                  toggle: () => setPeople((p) =>
                    p.includes(s) ? p.filter((x) => x !== s) : [...p, s]),
                })) }]} />
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              PNS PIC
            </span>
            <MultiSelect label="PNS PIC" picked={owners_}
              onClear={() => setOwners([])}
              sections={[{ label: null, items: [
                // Unassigned is a real answer here, and the one worth raising in the room.
                { key: "__unassigned__", label: "Unassigned",
                  on: owners_.includes("__unassigned__"),
                  toggle: () => setOwners((p) => p.includes("__unassigned__")
                    ? p.filter((x) => x !== "__unassigned__") : [...p, "__unassigned__"]) },
                ...owners.map((o) => ({
                  key: o, label: o, on: owners_.includes(o),
                  toggle: () => setOwners((p) =>
                    p.includes(o) ? p.filter((x) => x !== o) : [...p, o]),
                })),
              ] }]} />
          </div>
          {(people.length > 0 || owners_.length > 0) && (
            <button onClick={() => { setPeople([]); setOwners([]); }}
              className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-[12.5px]">
              Clear
            </button>
          )}
        </div>
        {regions.length > 0 && (
          <p className="text-[11.5px] text-slate-400">
            Both lists are narrowed to whoever has a live deal in {regions.join(", ")} —
            not the whole of Commercial or PNS.
          </p>
        )}
      </Card>

      <Block label="All pending" sub="Everything still open, by salesperson."
        list={pend} tone="bg-amber-50 text-amber-700" />
    </>
  );
}
