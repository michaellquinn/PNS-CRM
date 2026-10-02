import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Head } from "../ui";

/* One region per salesperson (Michael, 2026-10-02).

   Sales CRM sends no region, so the sync stamped every import GJ and a salesperson's
   deals split across regions — Dandy in GJ and EJ at once. Here an Admin gives each
   salesperson one region; saving moves every one of their deals to it, and the import,
   the sync, New request and a Sales PIC handover follow it from then on.

   The dropdown starts on the suggestion when nothing is set yet: the region most of their
   deals are already in, ignoring GJ when there is anything else, because GJ was the
   import's default rather than anybody's choice. */

const inputCls = "rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]";

export default function SalesRegions({ notify }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => api.salesRegions()
    .then((d) => {
      setData(d);
      setPick(Object.fromEntries(d.rows.map((r) => [r.name, r.region || r.suggested])));
    })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async (names) => {
    setBusy(true);
    try {
      for (const n of names) await api.setSalesRegion(n, pick[n]);
      notify(names.length === 1 ? `${names[0]} set to ${pick[names[0]]}` : `${names.length} salespeople saved`);
      await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  if (err) return <Empty>{err}</Empty>;
  if (!data) return <p>Loading…</p>;

  const changed = data.rows.filter((r) => pick[r.name] && pick[r.name] !== r.region).map((r) => r.name);
  const split = (r) => Object.keys(r.deals).filter((k) => r.deals[k] > 0).length > 1;

  return (
    <>
      <Head title="Sales regions"
        sub="One region per salesperson. A deal's region follows its Sales PIC — saving moves every one of that person's deals, and new and synced deals follow it from then on."
        right={<Btn kind="primary" disabled={busy || !changed.length} onClick={() => save(changed)}>
          Save all changes ({changed.length})
        </Btn>} />
      {data.rows.length === 0 ? <Empty>No salesperson on any ticket yet.</Empty> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2.5">Salesperson</th>
                <th className="px-4 py-2.5">Deals today, by region</th>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.name} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-semibold">
                    {r.name}
                    {!r.region && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10.5px] font-bold uppercase text-amber-700">not set</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={split(r) ? "text-rose-700" : "text-slate-600"}>
                      {Object.entries(r.deals).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}
                    </span>
                    {split(r) && <span className="ml-2 text-[11px] text-rose-600">split</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <select className={inputCls} value={pick[r.name] || ""}
                      onChange={(e) => setPick({ ...pick, [r.name]: e.target.value })}>
                      {data.regions.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    {!r.region && pick[r.name] === r.suggested && (
                      <span className="ml-2 text-[11px] text-slate-400">suggested</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Btn disabled={busy || pick[r.name] === r.region} onClick={() => save([r.name])}>Save</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
