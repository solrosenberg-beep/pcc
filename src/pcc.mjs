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
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": process.env.PCC_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
      referer: base.replace(/\/$/, "") + "/home/home.jsp",
      "sec-ch-ua": '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
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

// Parse one ub04batchinvoices.jsp page into individual claim rows.
export function parseInvoices(html) {
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const tr = m[1];
    const idM = tr.match(/ESOLinvoiceid=(\d+)/i) || tr.match(/name=["']ESOLinvoiceid["'][^>]*value=["'](\d+)["']/i);
    if (!idM) continue;
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]));
    if (cells.length < 10) continue;
    const clientM = tr.match(/ESOLclientid=(\d+)/i);
    out.push({
      invoiceId: idM[1], clientId: clientM ? clientM[1] : null,
      resident: cells[3], payer: cells[4], type: cells[5], billType: cells[6],
      from: cells[7], to: cells[8], amount: money(cells[9]),
    });
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.invoiceId) ? false : seen.add(r.invoiceId)));
}

// Individual claims inside one batch.
export async function getBatchInvoices(batchId) {
  if (!/^\d+$/.test(String(batchId))) throw new PccError("Invalid batch id.", { status: 400 });
  const html = await pccGet(`/admin/billing/ub04batchinvoices.jsp?ESOLbatchId=${batchId}`);
  return parseInvoices(html);
}

// Every individual claim across all batches, flattened (one row per claim).
export async function getAllClaims(opts = {}) {
  const batches = await getClaims(opts);
  const claims = [];
  for (const b of batches) {
    try {
      const inv = await getBatchInvoices(b.batchId);
      for (const c of inv) claims.push({ ...c, batch: b.id, batchDescription: b.description, batchStatus: b.status });
    } catch (e) { /* skip a batch that fails; keep going */ }
  }
  return claims;
}

// Pull all claim batches for the given statuses, following pagination (20 rows/page).
// PCC status codes: "" = All, O = Open, E = Exported, A = Accepted, N = Do Not Submit.
// Default is "" (All) so every batch shows, not just Open.
export async function getClaims({ statuses, maxPages = 100 } = {}) {
  const raw = statuses?.length != null ? statuses : (process.env.PCC_STATUSES ?? "");
  const list = Array.isArray(raw) ? raw : String(raw).split(",").map((s) => s.trim());
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
