// Turn a Project Charter into something you can paste into an email.
//
// Two constraints drive everything here:
//   1. Email clients strip <style> blocks and know nothing about Tailwind, so every rule
//      has to be an inline style attribute on the element itself.
//   2. To keep the table structure on paste, the clipboard needs a real text/html
//      flavour. Copying the rendered DOM would carry class names that mean nothing in
//      Gmail, so the HTML is built from the data instead.
//
// A text/plain flavour goes on the clipboard alongside it, for anywhere that refuses
// HTML (Slack, plain-text mail).

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const S = {
  table: "border-collapse:collapse;width:100%;max-width:760px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827",
  section: "background:#f1f5f9;font-weight:bold;font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:#334155;padding:8px 10px;border:1px solid #cbd5e1",
  label: "width:34%;background:#f8fafc;padding:7px 10px;border:1px solid #e2e8f0;vertical-align:top;color:#475569",
  value: "padding:7px 10px;border:1px solid #e2e8f0;vertical-align:top",
  head: "font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;margin:0 0 2px",
  sub: "font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;margin:0 0 14px",
  note: "font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;margin:14px 0 0",
};

/**
 * @param t       ticket summary (ref, shipper, service, acct_type, revenue, status, …)
 * @param input   the intake payload
 * @param sections [[sectionLabel, [[key, label], …]], …] — same map the screen renders
 * @param display (key, value) => string, so "None" vs "—" stays consistent with the UI
 * @param extras  [[label, value], …] appended to the last section, e.g. the price file
 */
export function charterHtml(t, input, sections, display, extras = []) {
  const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const rows = [];

  rows.push(`<tr><td colspan="2" style="${S.section}">Ticket</td></tr>`);
  [
    ["Ticket", t.ref], ["Shipper", t.shipper], ["Account type", t.acct_type],
    ["Service", t.service], ["Potential revenue", rp(t.revenue)], ["Region", t.region],
    ["Status", t.status], ["Submitted", t.submitted_on],
    ["Sales PIC", t.sales || "—"], ["PNS owner", t.owner || "unassigned"],
  ].forEach(([l, v]) => {
    rows.push(`<tr><td style="${S.label}">${esc(l)}</td><td style="${S.value}">${esc(v)}</td></tr>`);
  });

  sections.forEach(([label, fields]) => {
    rows.push(`<tr><td colspan="2" style="${S.section}">${esc(label)}</td></tr>`);
    fields.forEach(([k, l]) => {
      const v = display(k, input[k]);
      rows.push(
        `<tr><td style="${S.label}">${esc(l)}</td>` +
        `<td style="${S.value}">${v ? esc(v).replace(/\n/g, "<br>") : "&mdash;"}</td></tr>`);
    });
  });

  extras.forEach(([l, v]) => {
    rows.push(`<tr><td style="${S.label}">${esc(l)}</td><td style="${S.value}">${esc(v)}</td></tr>`);
  });

  return (
    `<div>` +
    `<p style="${S.head}">Project Charter &mdash; ${esc(t.shipper)}</p>` +
    `<p style="${S.sub}">${esc(t.ref)} &middot; ${esc(t.service)} &middot; ${esc(rp(t.revenue))}</p>` +
    `<table style="${S.table}" cellspacing="0" cellpadding="0"><tbody>${rows.join("")}</tbody></table>` +
    `<p style="${S.note}">Generated from Ninja PNS. Price only &mdash; this charter carries no cost or margin.</p>` +
    `</div>`
  );
}

export function charterText(t, input, sections, display, extras = []) {
  const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const out = [`PROJECT CHARTER — ${t.shipper}`, `${t.ref} · ${t.service} · ${rp(t.revenue)}`, ""];
  const line = (l, v) => out.push(`${l.padEnd(28)}: ${v ?? "—"}`);

  out.push("TICKET");
  line("Ticket", t.ref); line("Shipper", t.shipper); line("Account type", t.acct_type);
  line("Service", t.service); line("Potential revenue", rp(t.revenue));
  line("Region", t.region); line("Status", t.status); line("Submitted", t.submitted_on);
  line("Sales PIC", t.sales || "—"); line("PNS owner", t.owner || "unassigned");

  sections.forEach(([label, fields]) => {
    out.push("", label.toUpperCase());
    fields.forEach(([k, l]) => line(l, display(k, input[k]) || "—"));
  });
  extras.forEach(([l, v]) => line(l, v));
  out.push("", "Price only — this charter carries no cost or margin.");
  return out.join("\n");
}

/**
 * Put both flavours on the clipboard. Falls back to a hidden selection + execCommand for
 * browsers without ClipboardItem, which also preserves the HTML.
 */
export async function copyRich(html, text) {
  if (navigator.clipboard && window.ClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return "rich";
  }

  const host = document.createElement("div");
  host.setAttribute("contenteditable", "true");
  host.innerHTML = html;
  host.style.cssText = "position:fixed;left:-99999px;top:0;opacity:0";
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand("copy");
  sel.removeAllRanges();
  document.body.removeChild(host);
  if (!ok) throw new Error("your browser blocked the copy — select the table and copy manually");
  return "fallback";
}
