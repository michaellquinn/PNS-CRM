import { useEffect, useState } from "react";
import { api } from "../api";
import { copyRich } from "../charter";
import { Btn, Card, Empty, Head } from "../ui";

/* Sales Planning's weekly deck page (Michael, 2026-09-29).

   Every deal PNS has finished with, for one pair of regions, grouped by where it stands
   in Sales CRM. Built as a plain table with INLINE styles on purpose: that is what
   survives a copy into Google Slides or PowerPoint, where class names mean nothing.

   Rules, as agreed: EKYC Approval and Contract Sent are Proposal Accepted; the summary
   counts deals whose Sales CRM close date falls in the next 14 days, and those rows are
   shaded; Expected M0 Revenue and Commercial Remarks are left blank for now. */

const TITLES = { "jabo-wj": "Jabo + WJ", "cj-ej": "CJ + EJ" };
const GROUP_FILL = {
  "Proposal Submitted": "#f4cccc",
  "Proposal Accepted": "#c9daf8",
  "Ready to Ship": "#d9ead3",
};
const HEAD = "#990000";
const SOON = "#fce5cd";

// Shipper names and stages come from Sales CRM, so they are escaped before they go into
// the HTML this screen renders AND copies — a name is data, never markup.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rp = (n) => (n == null ? "—" : `Rp${Number(n).toLocaleString("en-US")}`);
const mio = (n) => `${Math.round((n || 0) / 1_000_000).toLocaleString("en-US")} M`;

function tableHtml(data, title) {
  const cell = "border:1px solid #999;padding:4px 8px;font-family:Arial;font-size:12px;";
  const th = `${cell}background:${HEAD};color:#fff;font-weight:bold;text-align:center;`;
  const groups = data.groups.map((g) => [g, data.rows.filter((r) => r.group === g)])
    .filter(([, rows]) => rows.length);
  let body = "";
  for (const [g, rows] of groups) {
    rows.forEach((r, i) => {
      const bg = r.closing_soon ? SOON : "#ffffff";
      body += "<tr>"
        + (i === 0 ? `<td rowspan="${rows.length}" style="${cell}background:${GROUP_FILL[g]};font-weight:bold;">${esc(g)}</td>` : "")
        + `<td style="${cell}background:${bg};">${esc(r.shipper)}</td>`
        + `<td style="${cell}background:${bg};text-align:center;">${esc(r.crm_status)}</td>`
        + `<td style="${cell}background:${bg};text-align:right;">${rp(r.committed)}</td>`
        + `<td style="${cell}background:${bg};"></td>`
        + "</tr>";
    });
  }
  const sum = `${cell}background:#f3f3f3;text-align:center;`;
  const sumHead = `${cell}background:#783f04;color:#fff;font-weight:bold;text-align:center;`;
  return `<div style="font-family:Arial;">
<p style="color:#cc0000;font-size:20px;font-weight:bold;margin:0 0 6px;">Not Pending in PNS - ${esc(title)} : Open</p>
<table style="border-collapse:collapse;margin-bottom:10px;"><tr>
<td rowspan="2" style="${cell}background:#cc0000;color:#fff;font-weight:bold;text-align:center;">Total Closing in the<br>Next 2 weeks</td>
<td style="${sumHead}"># of Opportunities</td><td style="${sumHead}">Total Committed Revenue</td><td style="${sumHead}">Expected M0 Revenue</td></tr>
<tr><td style="${sum}">${data.summary.opportunities}</td><td style="${sum}">${mio(data.summary.committed)}</td><td style="${sum}"></td></tr></table>
<table style="border-collapse:collapse;"><tr>
<th style="${th}">PNS Status</th><th style="${th}">Shipper</th><th style="${th}">CRM Status</th><th style="${th}">Committed Rev</th><th style="${th}">Commercial Remarks</th></tr>
${body}</table></div>`;
}

function tableText(data) {
  const lines = [["PNS Status", "Shipper", "CRM Status", "Committed Rev", "Commercial Remarks"].join("\t")];
  data.rows.forEach((r) => lines.push([r.group, r.shipper, r.crm_status || "", rp(r.committed), ""].join("\t")));
  return lines.join("\n");
}

export default function WeeklyStage({ report = "jabo-wj", notify, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api.weeklyStage(report).then(setData).catch((e) => setErr(e.message));
  }, [report]);
  const title = TITLES[report] || report;

  const copy = async () => {
    try {
      await copyRich(tableHtml(data, title), tableText(data));
      notify("Table copied — paste it into the deck");
    } catch (e) { notify(`Could not copy: ${e.message}`); }
  };

  return (
    <>
      <Head title={`${title.replace(" + ", " - ")} Weekly Stage`}
        sub={`Every deal PNS has finished with in ${title}, grouped by Sales CRM stage. Shaded rows close in the next 2 weeks (Sales CRM close date). As of ${data?.as_of || "…"}.`}
        right={data && <Btn kind="primary" onClick={copy}>Copy table</Btn>} />
      {err && <Empty>{err}</Empty>}
      {!data && !err && <p>Loading…</p>}
      {data && (data.rows.length === 0 ? <Empty>No open deals past PNS in {title}.</Empty> : (
        <Card className="overflow-x-auto p-4">
          {/* Rendered from the same HTML that is copied, so what you see is what pastes. */}
          <div dangerouslySetInnerHTML={{ __html: tableHtml(data, title) }} />
          <p className="mt-3 text-[11.5px] text-slate-400">
            Expected M0 Revenue and Commercial Remarks are left blank. Deals at Closed-Won are not listed.
            {" "}Click a ticket number below to open it:
          </p>
          <div className="mt-1 flex flex-wrap gap-2 text-[11.5px]">
            {data.rows.map((r) => (
              <button key={r.ref} type="button" onClick={() => onOpen(r.ref)}
                className="font-mono text-[#EE1B2C] hover:underline">{r.ref}</button>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
