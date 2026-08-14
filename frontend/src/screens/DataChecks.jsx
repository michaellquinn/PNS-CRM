import { useEffect, useState } from "react";
import { api, rp } from "../api";
import { Btn, Card, Empty, Head, Pill } from "../ui";

// What people call "duplicate tickets". Three different things get that name and they
// have three different fixes, so the screen names which one it found rather than listing
// pairs and leaving the diagnosis to whoever is looking.
//
// tickets.opportunity_id is UNIQUE (V12), so one Sales CRM opportunity can never be
// imported twice. Everything below is a gap that constraint leaves open.

const KIND = {
  "no-crm-id": {
    label: "Raised here, then imported again",
    tone: "bg-rose-50 text-rose-700",
    note: "MySQL lets a UNIQUE column hold any number of NULLs, so a ticket raised here before the opportunity existed in Sales CRM has no id to collide with. When the sync later imports the same deal under its real id, nothing connects the two. This is the common one.",
  },
  "same-deal": {
    label: "Two Sales CRM opportunities, one deal",
    tone: "bg-amber-50 text-amber-700",
    note: "Both tickets are correctly linked; the duplication is in Sales CRM. It is fixed there — this app follows the stage.",
  },
  shipper: {
    label: "One account under two names",
    tone: "bg-violet-50 text-violet-700",
    note: "The tickets are fine, the account is split. Account totals and the Hypercare/Strategic tier can disagree between the two rows until they are merged.",
  },
};

function Row({ g, onOpen }) {
  const k = KIND[g.kind] || { label: g.kind, tone: "bg-slate-100 text-slate-600", note: "" };
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <Pill tone={k.tone}>{k.label}</Pill>
        <b className="text-[13px]">{g.key}</b>
        <span className="ml-auto text-[12px] text-slate-500">{g.tickets.length} tickets</span>
      </div>
      <div className="px-4 py-3">
        <p className="mb-2.5 text-[12.5px] leading-relaxed text-slate-600">{g.why}</p>
        {g.tickets.map((t) => (
          <div key={t.ref}
            className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2 last:border-0">
            <button onClick={() => onOpen(t.ref)}
              className="font-mono text-[12.5px] font-bold text-[#EE1B2C] hover:underline">
              {t.ref}
            </button>
            <Pill dot>{t.status}</Pill>
            <span className="text-[12.5px]">{t.shipper}</span>
            <span className="text-[12px] text-slate-500">{t.service}</span>
            <span className="font-mono text-[12px] tabular-nums text-slate-600">{rp(t.revenue)}</span>
            <span className="font-mono text-[11.5px] text-slate-400">
              {t.opportunity_id ? `CRM ${t.opportunity_id}` : "no CRM id"}
            </span>
            <span className="ml-auto text-[11.5px] text-slate-400">
              {t.submitted_on}{t.sales ? ` · ${t.sales}` : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function DataChecks({ me, onOpen }) {
  const [dup, setDup] = useState(null);
  const [orphan, setOrphan] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    api.duplicates().then(setDup).catch((e) => setErr(e.message)).finally(() => setBusy(false));
    // Admin-only, so a non-admin simply does not get this half of the screen.
    if (me.permissions.manageUsers) api.orphanedStatus().then(setOrphan).catch(() => {});
  };
  useEffect(load, []);

  return (
    <>
      <Head title="Data checks"
        sub="What is actually wrong with the data, as opposed to what looks wrong. Run it before a review meeting."
        right={<Btn disabled={busy} onClick={load}>Re-run</Btn>} />

      {err && <Card className="mb-4 border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>}
      {dup === null && !err && <p className="text-sm text-slate-400">Loading…</p>}

      {dup && (
        <>
          <Card className="mb-4 p-4">
            <h2 className="text-[13.5px] font-semibold">Before you read this as duplication</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
              {dup.siblings} account{dup.siblings === 1 ? " has" : "s have"} more than one
              live ticket, and that is normal — a ticket is raised per <b>opportunity</b>,
              and one account runs several at once. They are not listed here. Read them on
              the <b>Accounts</b> screen, which groups the same tickets by account.
              <br />
              Below are only the cases where two tickets really do cover one deal, or one
              account has arrived under two names.
            </p>
          </Card>

          {dup.groups.length === 0 ? (
            <Empty>Nothing duplicated. Every live deal is on exactly one ticket.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {dup.groups.map((g, i) => <Row key={i} g={g} onOpen={onOpen} />)}
            </div>
          )}

          {/* The fix for each kind, once, rather than repeated on every card. */}
          <Card className="mt-4 p-4">
            <h2 className="text-[13.5px] font-semibold">What each one means</h2>
            <div className="mt-2 flex flex-col gap-2.5">
              {Object.entries(KIND).map(([id, k]) => (
                <div key={id} className="text-[12.5px] leading-relaxed">
                  <Pill tone={k.tone}>{k.label}</Pill>
                  <p className="mt-1 text-slate-600">{k.note}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {orphan && orphan.tickets.length > 0 && (
        <Card className="mt-4 border-amber-200 bg-amber-50 p-4">
          <h2 className="text-[13.5px] font-semibold text-amber-900">
            {orphan.tickets.length} ticket(s) in a status this build does not recognise
          </h2>
          <p className="mt-1 text-[12.5px] text-amber-900">
            Two people deploy into one database. A status written by another build lands
            here; the ticket cannot be acted on until it is renamed by a migration.
          </p>
          <div className="mt-2">
            {orphan.tickets.map((t) => (
              <div key={t.ref} className="flex flex-wrap items-center gap-3 py-1 text-[12.5px]">
                <button onClick={() => onOpen(t.ref)}
                  className="font-mono font-bold text-[#EE1B2C] hover:underline">{t.ref}</button>
                <span>{t.shipper}</span>
                <code className="font-mono text-[11.5px]">{t.status}</code>
                <span className="text-slate-500">since {t.status_since}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
