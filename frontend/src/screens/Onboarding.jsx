import { useEffect, useState } from "react";
import { api, rp } from "../api";
import { Btn, Card, Empty, Head, Pill, TicketCard, inputCls } from "../ui";

// Onboarding is not solutioning, so it lives outside that menu. Solutioning ends when
// the shipper accepts; onboarding begins there and asks a different question — can Ops
// actually take this on. Two screens, and the boundary between them is one fact: has
// Sales supplied the shipper ID and the go-live date. Until both exist Ops has nothing
// to act on, so nothing else about the ticket matters here.

function Missing({ i }) {
  const gaps = [
    !String(i?.shipperId || "").trim() && "Shipper ID",
    !String(i?.golive || "").trim() && "Go-live date",
    !String(i?.parentShipperId || "").trim() && "Parent shipper ID",
    !String(i?.branchId || "").trim() && "Corporate branch ID",
  ].filter(Boolean);
  if (!gaps.length) return null;
  return (
    <p className="text-[12.5px] text-amber-800">
      Still needed: <b>{gaps.join(", ")}</b>
    </p>
  );
}

/* ------------------------------------------------------------------ to hand over */
// Won deals that cannot be onboarded yet. This is Sales' list: they hold the shipper
// relationship, so they are the ones who can produce the two missing facts.
export function ToHandOver({ me, notify, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [inputs, setInputs] = useState({});
  const [busy, setBusy] = useState(null);

  const load = () => api.tickets({ onboarding: "ready" })
    .then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const save = async (ref) => {
    const v = inputs[ref] || {};
    if (!v.shipperId?.trim() || !v.golive?.trim())
      return notify("Both the shipper ID and the go-live date are needed");
    setBusy(ref);
    try {
      await api.editInput(ref, { payload: {
        shipperId: v.shipperId.trim(),
        golive: v.golive.trim(),
        ...(v.parentShipperId?.trim() ? { parentShipperId: v.parentShipperId.trim() } : {}),
        ...(v.branchId?.trim() ? { branchId: v.branchId.trim() } : {}),
      } });
      notify(`${ref} handed to onboarding`);
      await load();
    } catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  const set = (ref, k) => (e) =>
    setInputs({ ...inputs, [ref]: { ...(inputs[ref] || {}), [k]: e.target.value } });

  if (err) return <Empty>{err}</Empty>;

  return (
    <>
      <Head title="To hand over"
        sub="Accepted deals that Ops cannot start yet. Add the shipper ID and the go-live date and the ticket moves to Onboarding — nothing else about it changes."
        right={rows && <Pill tone="bg-amber-50 text-amber-700">{rows.length} waiting</Pill>} />
      {rows === null && <p className="text-sm text-slate-400">Loading…</p>}
      {rows?.length === 0 && (
        <Empty>Nothing waiting. Every accepted deal has its shipper ID and go-live date.</Empty>
      )}
      <div className="flex flex-col gap-3">
        {(rows || []).map((t) => (
          <TicketCard key={t.ref} t={t} onOpen={onOpen}>
            <div className="mb-2.5"><Missing i={t.input} /></div>
            {me.permissions.editInput ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input className={inputCls} placeholder="Shipper ID *"
                  value={inputs[t.ref]?.shipperId || ""} onChange={set(t.ref, "shipperId")} />
                <input className={inputCls} type="date" placeholder="Go live *"
                  value={inputs[t.ref]?.golive || ""} onChange={set(t.ref, "golive")} />
                <input className={inputCls} placeholder="Parent shipper ID"
                  value={inputs[t.ref]?.parentShipperId || ""} onChange={set(t.ref, "parentShipperId")} />
                <input className={inputCls} placeholder="Corporate branch ID"
                  value={inputs[t.ref]?.branchId || ""} onChange={set(t.ref, "branchId")} />
                <div className="sm:col-span-2 lg:col-span-4">
                  <Btn kind="primary" disabled={busy === t.ref} onClick={() => save(t.ref)}>
                    Save and hand to onboarding
                  </Btn>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-slate-500">
                Sales fills these in — they hold the shipper relationship.
              </p>
            )}
          </TicketCard>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ onboarding */
// Everything Ops can actually work: won, identified, and with a date attached.
export function Onboarding({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.tickets({ onboarding: "live" })
      .then((d) => setRows(d.tickets)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty>{err}</Empty>;

  // Soonest go-live first: the list is a schedule, so it sorts like one.
  const sorted = [...(rows || [])].sort((a, b) =>
    String(a.input?.golive || "9999").localeCompare(String(b.input?.golive || "9999")));

  return (
    <>
      <Head title="Onboarding"
        sub="Accepted deals with a shipper ID and a go-live date. Ops work from this list; the Project Charter on each ticket is the single source of truth for what was sold."
        right={rows && <Pill tone="bg-emerald-50 text-emerald-700">{rows.length} in flight</Pill>} />
      {rows === null && <p className="text-sm text-slate-400">Loading…</p>}
      {rows?.length === 0 && (
        <Empty>Nothing is ready to onboard yet. Check <b>To hand over</b> for what is missing.</Empty>
      )}
      {sorted.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  {["Go live", "Ticket", "Shipper", "Service", "Revenue", "Shipper ID",
                    "Branch ID", "PNS PIC", "Sales PIC"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.ref} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums font-semibold">
                      {t.input?.golive || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button onClick={() => onOpen(t.ref)}
                        className="font-mono font-semibold text-[#EE1B2C] hover:underline">
                        {t.ref}
                      </button>
                    </td>
                    <td className="min-w-[240px] px-4 py-3 font-medium">{t.shipper}</td>
                    <td className="whitespace-nowrap px-4 py-3">{t.service}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums">{rp(t.revenue)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px]">
                      {t.input?.shipperId || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px]">
                      {t.input?.branchId || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{t.owner || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{t.sales || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
