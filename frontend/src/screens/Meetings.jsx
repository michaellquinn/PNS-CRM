import { useEffect, useMemo, useState } from "react";
import { api, PENDING, groupTone, rp } from "../api";
import { Btn, Card, Head, Pill } from "../ui";

// Review meeting, run by region. Pick the regions in the room, and both people lists —
// the salesperson who sold it and the PNS PIC holding it — narrow to whoever actually
// has deals there. Picking from all of Commercial when three of them cover your region
// is how an agenda ends up with somebody else's deals in it.

const REGIONS = ["GJ", "WJ", "CJ", "EJ"];

const sel = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12.5px]";

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

/* ---------------------------------------------------------------- review meeting */
export function ReviewMeeting({ onOpen }) {
  const [props_, setProps] = useState(null);
  const [pend, setPend] = useState(null);
  const [regions, setRegions] = useState([]);
  // Salesperson and PNS PIC are dropdowns rather than the toggle row the regions use:
  // there are four regions and there are as many names as the company has people, and a
  // wrapping row of thirty pills is the thing that made this bar hard to read.
  const [person, setPerson] = useState("");
  const [owner, setOwner] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    setProps(null); setPend(null);
    const region = regions.length ? regions : undefined;
    Promise.all([
      api.tickets({ status: "Proposal Submitted", region }),
      api.tickets({ status: PENDING, region }),
    ]).then(([a, b]) => { setProps(a.tickets); setPend(b.tickets); })
      .catch((e) => setErr(e.message));
  }, [regions.join(",")]);

  const all = [...(props_ || []), ...(pend || [])];

  // The salesperson list is derived from the tickets ALREADY narrowed to the chosen
  // regions, so it answers "who has deals in the room" rather than "who exists". There
  // is no region column on a user, and inventing one would be a second thing to keep in
  // step with reality.
  const sales = useMemo(
    () => [...new Set(all.map((t) => t.sales).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);

  // The PNS side of the same question. A review meeting walks Sales' deals, but the
  // answer to "where is this one" is usually a PNS name, so the agenda has to be
  // narrowable by who is holding it as well as by who sold it.
  const owners = useMemo(
    () => [...new Set(all.map((t) => t.owner).filter(Boolean))].sort(),
    [all.length, regions.join(",")]);

  // Somebody picked for one region and then deselected with the region should not keep
  // filtering invisibly.
  useEffect(() => {
    if (person && !sales.includes(person)) setPerson("");
  }, [sales.join(",")]);
  useEffect(() => {
    if (owner && owner !== "__unassigned__" && !owners.includes(owner)) setOwner("");
  }, [owners.join(",")]);

  const keep = (list) =>
    (list || []).filter((t) =>
      (!person || t.sales === person)
      && (!owner || (owner === "__unassigned__" ? !t.owner : t.owner === owner)));

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
      <Head title="Review meeting"
        sub="Walk the list top to bottom. Proposals first, then everything pending — grouped by the salesperson who presents it."
        right={<Btn onClick={() => window.print()}>Print agenda</Btn>} />

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
            <select className={sel} value={person} onChange={(e) => setPerson(e.target.value)}
              disabled={sales.length === 0}>
              <option value="">
                {sales.length === 0
                  ? (props_ === null ? "Loading…" : "Nobody in those regions")
                  : "Everyone"}
              </option>
              {sales.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
              PNS PIC
            </span>
            <select className={sel} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Anyone</option>
              {/* Unassigned is a real answer here, and the one worth raising in the room. */}
              <option value="__unassigned__">Unassigned</option>
              {owners.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          {(person || owner) && (
            <button onClick={() => { setPerson(""); setOwner(""); }}
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

      <div className="flex flex-col gap-4">
        <Block label="A · Proposals submitted" sub="Start here. Each salesperson walks their own."
          list={props_} tone="bg-teal-50 text-teal-700" />
        <Block label="B · All pending" sub="Everything still open, by salesperson."
          list={pend} tone="bg-amber-50 text-amber-700" />
      </div>
    </>
  );
}
