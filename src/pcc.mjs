// Read-only client for a logged-in PointClickCare session — CLAIMS (UB-04 batches).
//
// Mapped from a real network capture: PCC serves the claims list as server-rendered HTML
// at /admin/billing/ub04batchlist.jsp on the org's app host (e.g. www28.pointclickcare.com).
// Each row is one UB-04 claim batch: number, date, description, payer (submitter profile),
// status, claim count, and batch total, plus an ESOLbatchId for drill-down into the
// individual claims (ub04batchinvoices.jsp — wired once that page is captured).

import { getSession, clearSession } from "./session.mjs";

export class PccError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

function clean(s) {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
}
function money(s) { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }

// Parse one ub04batchlist.jsp page into claim-batch rows.
export function parseBatches(html) {
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    const idM = tr.match(/ESOLbatchId=(\d+)/i);
    if (!idM) continue;
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]));
    if (cells.length < 10) continue;
    out.push({
      batchId: idM[1],
      number: cells[1],
      date: cells[3],
      description: cells[4],
      payer: cells[5],
      revisedBy: cells[6],
      status: cells[7] || "Open",
      claims: parseInt(cells[8], 10) || 0,
      amount: money(cells[9]),
    });
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.batchId) ? false : seen.add(r.batchId)));
}

// Authenticated GET using the pasted session cookie.
async function pccGet(path) {
  const { cookie, base } = getSession();
  const url = path.startsWith("http") ? path : base.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,*/*",
      "user-agent": "Mozilla/5.0 (pcc-console)",
      cookie,
    },
  });
  if (res.status === 302 || res.status === 401 || res.status === 403) {
    clearSession();
    throw new PccError(`PointClickCare session is not valid or has expired (HTTP ${res.status}).`, { status: res.status, url });
  }
  const text = await res.text();
  if (/userLogin\.xhtml|name=["']loginForm["']|please log in/i.test(text)) {
    clearSession();
    throw new PccError("PointClickCare returned the login page — the session is not valid.", { status: 401, url });
  }
  return text;
}

// Confirm the pasted session works by loading the (authenticated) claims list page.
export async function validateSession() {
  await pccGet("/admin/billing/ub04batchlist.jsp?ESOLrow=1&ESOLview=default&ESOLstatus=O&ESOLsubmitterfilterid=-1");
  return { ok: true, who: null };
}

// Pull all claim batches for the given statuses, following pagination (20 rows/page).
export async function getClaims({ statuses, maxPages = 50 } = {}) {
  const list = statuses?.length ? statuses : (process.env.PCC_STATUSES || "O").split(",").map((s) => s.trim());
  const all = [];
  for (const status of list) {
    for (let page = 0; page < maxPages; page++) {
      const row = 1 + page * 20;
      const html = await pccGet(`/admin/billing/ub04batchlist.jsp?ESOLrow=${row}&ESOLview=default&ESOLstatus=${encodeURIComponent(status)}&ESOLsubmitterfilterid=-1`);
      const batches = parseBatches(html);
      all.push(...batches);
      if (batches.length < 20) break; // last page
    }
  }
  // De-dup across pages/statuses and shape for the console.
  const seen = new Set();
  return all
    .filter((b) => (seen.has(b.batchId) ? false : seen.add(b.batchId)))
    .map((b) => ({
      id: b.number, batchId: b.batchId, description: b.description, payer: b.payer,
      dos: b.date, claims: b.claims, amount: b.amount, status: b.status, revisedBy: b.revisedBy,
    }));
}
