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
  deleted: () => call("/tickets/deleted"),
  ticket: (ref) => call(`/tickets/${encodeURIComponent(ref)}`),

  createTicket: (body) => call("/tickets", { method: "POST", body: JSON.stringify(body) }),
  price: (ref, body) => call(`/tickets/${ref}/price`, { method: "POST", body: JSON.stringify(body) }),
  status: (ref, body) => call(`/tickets/${ref}/status`, { method: "POST", body: JSON.stringify(body) }),
  // owner and reviewer are independent; "" clears one, undefined leaves it alone
  assign: (ref, body) => call(`/tickets/${ref}/assign`, { method: "POST", body: JSON.stringify(body) }),
  editInput: (ref, body) => call(`/tickets/${ref}/input`, { method: "PATCH", body: JSON.stringify(body) }),
  setSales: (ref, name) => call(`/tickets/${ref}/sales`, { method: "POST", body: JSON.stringify({ name }) }),
  reopen: (ref, status) => call(`/tickets/${ref}/reopen`, { method: "POST", body: JSON.stringify({ status }) }),
  headAck: (ref) => call(`/tickets/${ref}/head-ack`, { method: "POST" }),
  psp: (ref, body) => call(`/tickets/${ref}/psp`, { method: "POST", body: JSON.stringify(body) }),
  pspAssign: (ref, assignee) =>
    call(`/tickets/${ref}/psp-assign`, { method: "POST", body: JSON.stringify({ assignee }) }),
  submitProposal: (ref) => call(`/tickets/${ref}/submit-proposal`, { method: "POST" }),
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
  addComment: (ref, body) =>
    call(`/tickets/${encodeURIComponent(ref)}/comments`, { method: "POST", body: JSON.stringify(body) }),
  resolveComment: (id) => call(`/comments/${id}/resolve`, { method: "POST" }),

  users: () => call("/users"),
  directory: () => call("/users/directory"),
  assignable: () => call("/users/assignable"),
  registerUser: (body) => call("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (email, body) =>
    call(`/users/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateUser: (email) =>
    call(`/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

export const SERVICES = ["LTL", "B2BR", "B2C", "FTL on-call", "FTL monthly", "Sameday"];

export const STATUSES = [
  "Pending Sales", "Pending Head Review", "Pending PNS", "Pending PNS Review",
  "Pending PSP Approval", "Pending Vendor", "Proposal Submitted",
  "Proposal Accepted / Ready to Ship", "Lost", "Cancel",
];

export const PENDING = STATUSES.filter((s) => s.startsWith("Pending"));

export const LOSS_REASONS = [
  ["pricing", "Lost on price"],
  ["shipper", "Shipper withdrew"],
  ["solution", "Solution not accepted"],
  ["ops", "Operations could not serve it"],
  ["no_vendor", "No vendor available"],
  ["billing", "Lost on billing terms"],
  ["pns", "Lost due to PNS"],
];

export const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

// Mirrors backend BOTTOM_MARGIN. Only LTL and B2BR have a published floor today — this
// is what decides whether the below-bottom checkbox even appears for a ticket's service;
// the server rejects the flag for anything else regardless of what the UI shows.
export const BOTTOM_MARGIN = { LTL: 5, B2BR: 10 };
