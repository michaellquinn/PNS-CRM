import { useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Card, Empty, Field, Head, Pill, inputCls, refreshPnsTeam } from "../ui";

const GROUP_TONE = {
  Admin: "bg-rose-50 text-rose-700",
  PNS: "bg-violet-50 text-violet-700",
  Commercial: "bg-sky-50 text-sky-700",
  PSP: "bg-amber-50 text-amber-700",
  CSO: "bg-teal-50 text-teal-700",
  Legal: "bg-slate-100 text-slate-600",
};

const WHAT_EACH_GROUP_DOES = {
  Commercial: "Raises tickets, prices what Sales owns, records win/loss. Cannot see cost or margin.",
  PNS: "Prices what PNS owns, reviews Sales pricing, runs CAPA. Sees cost and margin.",
  PSP: "Approves or rejects margins. Reads every ticket, because judging a rate needs the context around it. Sees cost and margin.",
  Legal: "Sees accepted deals only, for the contract. Can still be tagged into any discussion.",
  CSO: "Read-only across the pipeline, including cost and margin.",
  Admin: "Everything, plus registering people, setting roles and the recycle bin.",
};

const EMPTY_FORM = { email: "", name: "", group: "PNS", level: "staff", team: "Team1" };

// Nothing in the Substrait contract says whether the backend pod may open an outbound
// SMTP connection, so the only way to know is to try it from inside. SSO means neither
// the developer nor a script can reach the API — this has to be self-serve.
function EmailDelivery({ notify }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (send) => {
    setBusy(true);
    try {
      const out = await api.checkEmail(send);
      setR(out);
      if (out.sent_to) notify(`Test message sent to ${out.sent_to}`);
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const tone = !r ? "border-slate-200"
    : r.reachable ? "border-emerald-200 bg-emerald-50/40"
    : "border-amber-200 bg-amber-50/40";

  return (
    <Card className={`mt-5 p-4 ${tone}`}>
      <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        Email delivery
      </div>
      <p className="mb-3 text-[12.5px] text-slate-600">
        Personal notifications — assigned, tagged, sent back — can also go out by email
        through the Google Workspace SMTP relay. Broadcast updates never do. Check here
        whether this app can actually reach the relay.
      </p>

      {r && (
        <dl className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-[12.5px]">
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-slate-500">Status</dt>
            <dd className={r.reachable ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>
              {!r.configured ? "Not configured" : r.reachable ? "Relay reachable" : "Cannot reach the relay"}
            </dd>
          </div>
          {r.configured && (
            <>
              <div className="flex gap-2 py-0.5">
                <dt className="w-24 shrink-0 text-slate-500">Relay</dt>
                <dd className="font-mono">{r.host}:{r.port}</dd>
              </div>
              <div className="flex gap-2 py-0.5">
                <dt className="w-24 shrink-0 text-slate-500">Sends as</dt>
                <dd className="font-mono">{r.sender || "—"}</dd>
              </div>
            </>
          )}
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-slate-500">Detail</dt>
            <dd className="break-words">{r.detail}</dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => run(false)}>Test connection</Btn>
        <Btn kind="primary" disabled={busy || (r && !r.reachable)} onClick={() => run(true)}>
          Send me a test email
        </Btn>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Set SMTP_HOST, SMTP_FROM and APP_URL in the Substrait portal under Settings.
        With an IP-authenticated relay there is no password to store.
      </p>
    </Card>
  );
}

export default function Users({ me, notify }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const reload = () => {
    api.users().then(setData).catch((e) => setErr(e.message));
    refreshPnsTeam();
  };
  useEffect(() => { reload(); }, []);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); notify(msg); reload(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  const register = () => {
    if (!f.email.trim() || !f.name.trim()) return notify("Email and name are both required");
    act(() => api.registerUser({
      email: f.email.trim(), name: f.name.trim(), group: f.group, level: f.level,
      team: f.group === "Commercial" ? f.team : null,
    }).then(() => setF(EMPTY_FORM)), `${f.name.trim()} can now sign in`);
  };

  if (err)
    return (
      <>
        <Head title="Users &amp; roles" />
        <Card className="border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{err}</Card>
      </>
    );
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const rows = data.users.filter((r) => showInactive || r.active);
  const mayGrantAdmin = me.permissions.grantAdmin;
  const groupOptions = (current) =>
    data.groups.filter((g) => g !== "Admin" || mayGrantAdmin || current === "Admin");

  const th = "whitespace-nowrap px-4 py-3";
  const td = "whitespace-nowrap px-4 py-2.5";
  const cell = "rounded-lg border border-slate-300 px-2 py-1 text-[12.5px] disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <>
      <Head
        title="Users &amp; roles"
        sub="Google decides who you are; this screen decides what you may do. Anyone not listed here is turned away at the door."
        right={
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show revoked
          </label>
        }
      />

      <Card className="mb-5 p-5">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          Register someone
        </div>
        <p className="mb-4 text-[12.5px] text-slate-500">
          Use their Ninja Google account address — it has to match what SSO sends, or they
          still get turned away.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email" required>
            <input className={inputCls} value={f.email} placeholder="nama.lengkap@ninjavan.co"
              onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Full name" required hint="Shown on tickets, history and assignee lists">
            <input className={inputCls} value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Role group" required hint={WHAT_EACH_GROUP_DOES[f.group]}>
            <select className={inputCls} value={f.group}
              onChange={(e) => setF({ ...f, group: e.target.value })}>
              {groupOptions().map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Level" required hint="Heads approve below-bottom prices and assign work">
            <select className={inputCls} value={f.level}
              onChange={(e) => setF({ ...f, level: e.target.value })}>
              {data.levels.map((l) => <option key={l} value={l}>{l === "head" ? "Head" : "Staff"}</option>)}
            </select>
          </Field>
          {f.group === "Commercial" && (
            <Field label="Team" required hint="Team1 covers GJ and WJ, Team2 covers EJ and CJ">
              <select className={inputCls} value={f.team}
                onChange={(e) => setF({ ...f, team: e.target.value })}>
                {data.teams.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="text-[12px] text-slate-500">
            {mayGrantAdmin
              ? "You can grant Admin. Nobody else can — not even a PNS Head."
              : "Only an Admin can grant or revoke the Admin group."}
          </span>
          <Btn kind="primary" disabled={busy} onClick={register}>Register</Btn>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Empty>Nobody registered yet.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Group</th>
                  <th className={th}>Level</th>
                  <th className={th}>Team</th>
                  <th className={th}>Added</th>
                  <th className={th}>Access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Changing your own role is refused by the API too — this just explains why.
                  const locked = r.is_self;
                  const adminLocked = r.group === "Admin" && !mayGrantAdmin;
                  const frozen = busy || locked || adminLocked;
                  return (
                    <tr key={r.email} className={`border-t border-slate-100 ${r.active ? "" : "bg-slate-50/60 text-slate-400"}`}>
                      <td className={`${td} font-medium`}>
                        {r.name}
                        {locked && <span className="ml-2 text-[11px] font-normal text-slate-400">you</span>}
                      </td>
                      <td className={`${td} font-mono text-[12px] text-slate-600`}>{r.email}</td>
                      <td className={td}>
                        {frozen ? (
                          <Pill tone={GROUP_TONE[r.group]}>{r.group}</Pill>
                        ) : (
                          <select className={cell} value={r.group}
                            onChange={(e) => act(() => api.updateUser(r.email, { group: e.target.value }),
                              `${r.name} is now ${e.target.value}`)}>
                            {groupOptions(r.group).map((g) => <option key={g}>{g}</option>)}
                          </select>
                        )}
                      </td>
                      <td className={td}>
                        <select className={cell} value={r.level} disabled={frozen}
                          onChange={(e) => act(() => api.updateUser(r.email, { level: e.target.value }),
                            `${r.name} set to ${e.target.value}`)}>
                          {data.levels.map((l) => <option key={l} value={l}>{l === "head" ? "Head" : "Staff"}</option>)}
                        </select>
                      </td>
                      <td className={td}>
                        {r.group === "Commercial" ? (
                          <select className={cell} value={r.team || "Team1"} disabled={frozen}
                            onChange={(e) => act(() => api.updateUser(r.email, { team: e.target.value }),
                              `${r.name} moved to ${e.target.value}`)}>
                            {data.teams.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${td} font-mono tabular-nums text-slate-500`}>{r.created_at}</td>
                      <td className={td}>
                        {r.active ? (
                          <Btn kind="danger" disabled={busy || locked || adminLocked}
                            onClick={() => act(() => api.deactivateUser(r.email), `${r.name} can no longer sign in`)}>
                            Revoke
                          </Btn>
                        ) : (
                          <Btn disabled={busy}
                            onClick={() => act(() => api.updateUser(r.email, { active: true }), `${r.name} restored`)}>
                            Restore
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EmailDelivery notify={notify} />

      <Card className="mt-5 p-4">
        <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
          What each group can do
        </div>
        <dl className="text-[13px]">
          {data.groups.map((g) => (
            <div key={g} className="flex flex-col gap-1 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:gap-3">
              <dt className="w-28 shrink-0"><Pill tone={GROUP_TONE[g]}>{g}</Pill></dt>
              <dd className="text-slate-600">{WHAT_EACH_GROUP_DOES[g]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] text-slate-500">
          Revoking is not a delete — the row stays so ticket and CAPA history keeps its
          names. Nobody can change their own role or revoke their own access, and the last
          active Admin cannot be removed.
        </p>
      </Card>
    </>
  );
}
