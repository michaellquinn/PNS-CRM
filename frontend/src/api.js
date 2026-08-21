// Same-origin relative /api paths only. In production the ingress routes /api to the
// backend; in dev the Vite proxy forwards it to :8000.

async function call(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) {
      p.set(k, Array.isArray(v) ? v.join(",") : v);
    }
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};

// Multipart needs its own path: setting Content-Type by hand would omit the boundary the
// browser generates, and the server would reject the body.
async function upload(path, formData) {
  const r = await fetch(`/api${path}`, { method: "POST", body: formData });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

// Phone photos are 3-6 MB and none of that detail survives being looked at on a laptop.
// Downscale in the browser so the upload is a few hundred KB and comfortably inside the
// server's cap. Anything that is not a raster image is passed through untouched.
export async function shrinkImage(file, maxEdge = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;      // unsupported format, no canvas — let the server decide
  }
}

export const api = {
  me: () => call("/me"),
  stats: () => call("/stats"),

  tickets: (filters) => call(`/tickets${qs(filters)}`),
  // The same tickets, grouped by the account they belong to. A ticket is still one
  // opportunity — this is the other way of reading the same rows, not a second store.
  accounts: (filters) => call(`/accounts${qs(filters)}`),
  deleted: () => call("/tickets/deleted"),
  // Dropped requests with the date and the name against each. Who and when come out of
  // the ticket history, which log_status() has always written — no new column.
  cancelled: () => call("/tickets/cancelled"),
  ticket: (ref) => call(`/tickets/${encodeURIComponent(ref)}`),

  createTicket: (body) => call("/tickets", { method: "POST", body: JSON.stringify(body) }),
  price: (ref, body) => call(`/tickets/${ref}/price`, { method: "POST", body: JSON.stringify(body) }),
  status: (ref, body) => call(`/tickets/${ref}/status`, { method: "POST", body: JSON.stringify(body) }),
  // "" clears the owner. The separate reviewer slot was retired on 2026-08-14;
  // the endpoint still accepts and ignores the field so an old open tab does not 422.
  assign: (ref, body) => call(`/tickets/${ref}/assign`, { method: "POST", body: JSON.stringify(body) }),
  editInput: (ref, body) => call(`/tickets/${ref}/input`, { method: "PATCH", body: JSON.stringify(body) }),
  setSales: (ref, name) => call(`/tickets/${ref}/sales`, { method: "POST", body: JSON.stringify({ name }) }),
  setMustWin: (ref, must_win) =>
    call(`/tickets/${ref}/must-win`, { method: "POST", body: JSON.stringify({ must_win }) }),
  setCrmId: (ref, opportunity_id) =>
    call(`/tickets/${ref}/crm-id`, { method: "POST", body: JSON.stringify({ opportunity_id }) }),
  reopen: (ref, status) => call(`/tickets/${ref}/reopen`, { method: "POST", body: JSON.stringify({ status }) }),
  // The Head of PNS finalises the solution; the server decides what comes next, so the
  // caller cannot accidentally skip PSP or C-level by naming a status.
  pnsFinal: (ref) => call(`/tickets/${ref}/pns-final`, { method: "POST" }),
  // The ordinary review, not the Head's. Separate endpoint because it is a different
  // act by a different person — see the two "Pending Review" gates in the status flow.
  pnsReview: (ref) => call(`/tickets/${ref}/pns-review`, { method: "POST" }),
  psp: (ref, body) => call(`/tickets/${ref}/psp`, { method: "POST", body: JSON.stringify(body) }),
  execSignoff: (ref, body) =>
    call(`/tickets/${ref}/exec-signoff`, { method: "POST", body: JSON.stringify(body) }),
  signoffDraft: (ref) => call(`/tickets/${encodeURIComponent(ref)}/signoff-draft`),
  // Two documents, two audiences: the Charter goes to PNS and Sales, the Kick-off to
  // PNS, Sales and Ops. The server owns both lists.
  sendCharter: (ref, body) =>
    call(`/tickets/${encodeURIComponent(ref)}/charter/send`,
      { method: "POST", body: JSON.stringify(body || {}) }),
  sendKickoff: (ref, body) =>
    call(`/tickets/${encodeURIComponent(ref)}/kickoff/send`,
      { method: "POST", body: JSON.stringify(body || {}) }),
  workload: () => call("/workload"),
  // Whether the 5-minute timer is on, and what it did last. A failing timer is silent
  // by nature, so the Sync screen reads this and says so.
  autoSync: () => call("/sync/auto"),
  syncSalesCrm: (body) =>
    call("/sync/salescrm", { method: "POST", body: JSON.stringify(body || {}) }),
  pspAssign: (ref, assignee) =>
    call(`/tickets/${ref}/psp-assign`, { method: "POST", body: JSON.stringify({ assignee }) }),
  submitProposal: (ref) => call(`/tickets/${ref}/submit-proposal`, { method: "POST" }),
  allowPsp: (ref, body) =>
    call(`/tickets/${ref}/allow-psp`, { method: "POST", body: JSON.stringify(body) }),
  remove: (ref) => call(`/tickets/${ref}`, { method: "DELETE" }),
  restore: (ref) => call(`/tickets/${ref}/restore`, { method: "POST" }),
  purge: (ref) => call(`/tickets/${ref}/purge`, { method: "DELETE" }),
  options: () => call("/options"),

  capaFiles: (ref) => call(`/capa/${encodeURIComponent(ref)}/files`),
  uploadCapaFile: (ref, file, kind = "evidence", caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    if (caption) fd.append("caption", caption);
    return upload(`/capa/${encodeURIComponent(ref)}/files`, fd);
  },
  deleteCapaFile: (id) => call(`/capa-files/${id}`, { method: "DELETE" }),

  capa: (status) => call(`/capa${qs({ status })}`),
  raiseCapa: (body) => call("/capa", { method: "POST", body: JSON.stringify(body) }),
  submitCapa: (ref, body) => call(`/capa/${ref}/submit`, { method: "POST", body: JSON.stringify(body) }),
  closeCapa: (ref) => call(`/capa/${ref}/close`, { method: "POST" }),

  notifications: () => call("/notifications"),
  markRead: () => call("/notifications/read", { method: "POST" }),

  prefs: () => call("/me/preferences"),
  setPrefs: (body) => call("/me/preferences", { method: "POST", body: JSON.stringify(body) }),
  checkEmail: (send = false) =>
    call(`/diagnostics/email${send ? "?send=true" : ""}`, { method: "POST" }),
  orphanedStatus: () => call("/diagnostics/orphaned-status"),
  // The sync ignore list. Admin only — an id here makes a deal stop appearing.
  ignored: () => call("/salescrm/ignored"),
  addIgnored: (opportunity_id, reason) =>
    call("/salescrm/ignored", { method: "POST", body: JSON.stringify({ opportunity_id, reason }) }),
  removeIgnored: (oid) =>
    call(`/salescrm/ignored/${encodeURIComponent(oid)}`, { method: "DELETE" }),
  duplicates: () => call("/diagnostics/duplicates"),
  statusFlow: () => call("/reference/status-flow"),
  fieldGuide: () => call("/reference/fields"),

  files: (ref) => call(`/tickets/${encodeURIComponent(ref)}/files`),
  uploadFile: (ref, file, kind = "document", caption = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    if (caption) fd.append("caption", caption);
    return upload(`/tickets/${encodeURIComponent(ref)}/files`, fd);
  },
  deleteFile: (id) => call(`/files/${id}`, { method: "DELETE" }),

  comments: (ref) => call(`/tickets/${encodeURIComponent(ref)}/comments`),
  // body may carry thread_key (post into an existing thread) or new_thread_title
  // (start one). Neither means the general thread.
  addComment: (ref, body) =>
    call(`/tickets/${encodeURIComponent(ref)}/comments`, { method: "POST", body: JSON.stringify(body) }),
  resolveComment: (id) => call(`/comments/${id}/resolve`, { method: "POST" }),
  recapComments: (ref, body) =>
    call(`/tickets/${encodeURIComponent(ref)}/comments/recap`,
      { method: "POST", body: JSON.stringify(body || {}) }),

  users: () => call("/users"),
  directory: () => call("/users/directory"),
  assignable: () => call("/users/assignable"),
  registerUser: (body) => call("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (email, body) =>
    call(`/users/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateUser: (email) =>
    call(`/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

export const SERVICES = ["LTL", "B2BR", "B2C", "FTL on-call", "FTL monthly", "Sameday",
  "Fulfillment", "Complex Logistics"];

// Only the FTL lines are priced through a haulage vendor, so only they can wait on
// vendor cost. Keep in step with VENDOR_SERVICES in the backend.
export const FTL = ["FTL on-call", "FTL monthly"];

export const STATUSES = [
  "Pending CRM ID", "Open", "Pending Sales", "Pending PNS",
  "Pending Review - PNS", "Pending Review - Head PNS",
  "Pending Review - PSP", "Pending Review - Head PSP", "Pending Vendor", "Pending Review - C-level", "Proposal Submitted",
  "Proposal Accepted / Ready to Ship", "Lost", "Cancel",
];

export const PENDING = STATUSES.filter((s) => s.startsWith("Pending"));

// Everything still being worked, mirroring the backend's PENDING_STATUSES. "Pending CRM
// ID" is deliberately out: it is blocked on an id rather than waiting on a person, it
// cannot be worked until that arrives, and it has a queue of its own. Used by Open - PNS
// and by its sidebar badge, from one definition so the count and the list cannot drift.
export const LIVE_STATUSES = STATUSES.filter(
  (s) => s !== "Pending CRM ID" && (s === "Open" || s.startsWith("Pending")));

export const LOSS_REASONS = [
  ["pricing", "Lost on price"],
  ["shipper", "Shipper withdrew"],
  ["solution", "Solution not accepted"],
  ["ops", "Operations could not serve it"],
  ["no_vendor", "No vendor available"],
  ["billing", "Lost on billing terms"],
  ["pns", "Lost due to PNS"],
  // Set by the sync, not offered as a choice to people — kept here so the label
  // resolves wherever a loss reason is displayed.
  ["salescrm", "Closed in Sales CRM"],
];

// What a person may choose when recording a loss. "salescrm" is the sync's to set.
export const PICKABLE_LOSS_REASONS = LOSS_REASONS.filter(([v]) => v !== "salescrm");

export const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

// Mirrors backend BOTTOM_MARGIN. Only LTL and B2BR have a published floor today — this
// is what decides whether the below-bottom checkbox even appears for a ticket's service;
// the server rejects the flag for anything else regardless of what the UI shows.
export const BOTTOM_MARGIN = { LTL: 5, B2BR: 10 };

// Mirrors backend may_go_to_psp(). PSP is discretionary-only for a managed account
// (Hypercare/Strategic) or a ticket the PNS Head has opened on Alex's exception —
// everything else reaches PSP only by rule (a manual-review band, Sameday >20%
// discount), never through a person choosing to send it. Both places that let someone
// forward a ticket to PSP (the To-review button, the Escalate button) use this same
// check, and the server re-checks it independently either way.
export const mayGoToPsp = (t) =>
  t.acct_type === "Strategic" || t.acct_type === "Hypercare" || !!t.psp_allowed;

// What Dashboard PNS keeps and the all-tickets board does not filter on. A ticket is
// PNS's business when PNS owes the price (resp on the backend, priced_by here), or when
// PNS reviews a price Sales built (needs_review, which is review_level() server-side).
// Everything else in the book is Sales working alone, and since the Sales CRM sync
// imports every opportunity it can map, that is most of what makes the full board hard
// to read for a PNS reader. Deliberately NOT a status list: status changes through the
// life of a ticket and this does not, so a PNS ticket stays on the PNS board from intake
// to won or lost, rather than appearing and vanishing as it moves between gates.
export const isPnsWork = (t) => t.priced_by === "PNS" || !!t.needs_review;

// The three watched groups, in the order the rules treat them. Mirrors big_group() in
// the backend: Hypercare and Strategic sit on the ACCOUNT and are inherited from the
// Sales CRM account group; Must Win sits on ONE OPPORTUNITY, so the same account can
// have a must-win deal and five ordinary ones. Everything untagged is Standard.
export const WATCHED_GROUPS = [
  { id: "Hypercare", label: "Hypercare", level: "account",
    tone: "bg-rose-100 text-rose-800" },
  { id: "Strategic", label: "Strategic", level: "account",
    tone: "bg-indigo-100 text-indigo-800" },
  { id: "Must Win", label: "Must Win", level: "opportunity",
    tone: "bg-orange-100 text-orange-800" },
];

export const groupTone = (g) =>
  WATCHED_GROUPS.find((w) => w.id === g)?.tone || "bg-slate-100 text-slate-600";

// Which /api/tickets filter each group needs. Hypercare and Strategic are account tiers
// (acct_type); Must Win is a per-ticket flag, so it is a different parameter entirely —
// asking for acct_type="Must Win" returns nothing at all.
export const groupFilter = (g) =>
  g === "Must Win" ? { must_win: true } : g ? { acct_type: g } : {};
