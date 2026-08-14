import { useEffect, useMemo, useState } from "react";
import { api, PENDING, WATCHED_GROUPS, groupTone, rp } from "../api";
import { Btn, Card, Empty, Head, Pill, inputCls } from "../ui";

// Two meetings, two different questions, so two screens rather than one with a mode:
//
//   Review meeting   run by region. Pick the regions in the room, and the salesperson
//                    list narrows to the people who actually have deals there — picking
//                    from all of Commercial when three of them cover your region is how
//                    an agenda ends up with somebody else's deals in it.
//   Weekly meeting   run by PNS. Active Pending PNS, grouped by watched group first and
//                    by PNS member inside it, because the watched groups are what the
//                    meeting is for and the name is who speaks to it.

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

/* ---------------------------------------------------------------- review meeting */
export function ReviewMeeting({ onOpen }) {
  const [props_, setProps] = useState(null);
  const [pend, setPend] = useState(null);
  const [regions, setRegions] = useState([]);
  const [people, setPeople] = useState([]);
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

  // A salesperson picked for one region and then deselected with the region should not
  // keep filtering invisibly.
  useEffect(() => {
    setPeople((p) => p.filter((n) => sales.includes(n)));
  }, [sales.join(",")]);

  const keep = (list) =>
    (list || []).filter((t) => !people.length || people.includes(t.sales));

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
        <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3">
          <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Salesperson
          </span>
          {sales.length === 0 ? (
            <span className="text-[12.5px] text-slate-400">
              {props_ === null ? "Loading…" : "Nobody has a live deal in those regions."}
            </span>
          ) : (
            <Toggles options={sales} value={people} onChange={setPeople} empty="Everyone" />
          )}
        </div>
        {regions.length > 0 && (
          <p className="text-[11.5px] text-slate-400">
            The salesperson list is narrowed to whoever has a live deal in{" "}
            {regions.join(", ")} — not the whole of Commercial.
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

/* ---------------------------------------------------------------- weekly meeting */
export function WeeklyMeeting({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [regions, setRegions] = useState([]);
  const [people, setPeople] = useState([]);

  useEffect(() => {
    setRows(null);
    api.tickets({ status: "Pending PNS", region: regions.length ? regions : undefined })
      .then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  }, [regions.join(",")]);

  const sales = useMemo(
    () => [...new Set((rows || []).map((t) => t.sales).filter(Boolean))].sort(),
    [rows]);

  useEffect(() => { setPeople((p) => p.filter((s) => sales.includes(s))); }, [sales.join(",")]);

  const list = (rows || []).filter((t) => !people.length || people.includes(t.sales));

  // Watched group first, then the PNS member. That order is the point of the meeting:
  // the question in the room is "where are the Hypercare deals", and the name is who
  // answers it — not the other way round.
  const ORDER = [...WATCHED_GROUPS.map((g) => g.id), "Standard"];
  const byGroup = ORDER.map((g) => ({
    group: g,
    tickets: list.filter((t) => (t.group || "Standard") === g),
  })).filter((b) => b.tickets.length > 0);

  let n = 0;

  return (
    <>
      <Head title="Weekly meeting"
        sub="Everything actively on PNS right now, grouped by watched group and then by whoever holds it. This is the PNS side of the pipeline — the Review meeting is the Sales side."
        right={<Btn onClick={() => window.print()}>Print agenda</Btn>} />

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}

      <Card className="mb-4 flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Region
          </span>
          <Toggles options={REGIONS} value={regions} onChange={setRegions} empty="All regions" />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3">
          <span className="w-[92px] shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
            Salesperson
          </span>
          {sales.length === 0 ? (
            <span className="text-[12.5px] text-slate-400">
              {rows === null ? "Loading…" : "Nothing on PNS in those regions."}
            </span>
          ) : (
            <Toggles options={sales} value={people} onChange={setPeople} empty="Everyone" />
          )}
        </div>
      </Card>

      {rows === null && !err && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && list.length === 0 && (
        <Empty>Nothing sitting on PNS. The queue is clear.</Empty>
      )}

      <div className="flex flex-col gap-4">
        {byGroup.map(({ group, tickets }) => {
          const byPerson = tickets.reduce((acc, t) => {
            (acc[t.owner || "Unassigned"] ||= []).push(t);
            return acc;
          }, {});
          return (
            <Card key={group}>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h3 className="text-[13.5px] font-semibold">{group}</h3>
                  <p className="text-[12px] text-slate-500">
                    {group === "Standard"
                      ? "Not a watched group — walk these only if something is stuck."
                      : "Watched. The Head of PNS finalises these personally once priced."}
                  </p>
                </div>
                <Pill tone={group === "Standard" ? "bg-slate-100 text-slate-600" : groupTone(group)}>
                  {tickets.length}
                </Pill>
              </div>
              <div className="p-4">
                {/* Unassigned first: an unowned ticket in a watched group is the thing
                    most worth saying out loud in the room. */}
                {Object.keys(byPerson)
                  .sort((a, b) => (a === "Unassigned" ? -1 : b === "Unassigned" ? 1 : a.localeCompare(b)))
                  .map((person) => (
                    <div key={person} className="mb-4 border-l-2 border-[#EE1B2C] pl-3.5 last:mb-0">
                      <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                        <span className={person === "Unassigned" ? "text-amber-600" : ""}>
                          {person}
                        </span>
                        &middot; {byPerson[person].length}
                      </div>
                      {byPerson[person].map((t) => {
                        n += 1;
                        return <Line key={t.ref} n={n} t={t} onOpen={onOpen}
                          right={`${t.region} · ${t.sales || "no sales PIC"} · ${t.sla_elapsed}/${t.sla_target}d`} />;
                      })}
                    </div>
                  ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
