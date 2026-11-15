// Express server for the PCC claims console. Serves the login-gated dashboard and a
// small read-only API. Credentials live in memory only (see session.mjs).

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setRuntimeCredentials, clearSession, hasRuntimeCredentials } from "./session.mjs";
import { validateSession, getClaims, getBatchInvoices, getAllClaims, getFacilities, switchFacility, keepAlivePing, PccError } from "./pcc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "..", "console")));

// Clean a pasted cookie header: strip newlines/quotes, collapse whitespace.
function normalizeCookie(raw) {
  if (!raw) return "";
  return String(raw).replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/;$/, "");
}

// Keep-alive heartbeat: ping PCC on a timer so the session doesn't idle-out while connected.
let heartbeat = null, lastPing = null, lastPingOk = null;
const HEARTBEAT_MS = Number(process.env.PCC_HEARTBEAT_MS) || 4 * 60 * 1000; // every 4 min
function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(async () => {
    try { await keepAlivePing(); lastPing = Date.now(); lastPingOk = true; }
    catch (e) { lastPing = Date.now(); lastPingOk = false; stopHeartbeat(); console.log("[pcc] keep-alive stopped — session ended:", e.message); }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();
  console.log(`[pcc] keep-alive started (every ${Math.round(HEARTBEAT_MS / 60000)} min)`);
}
function stopHeartbeat() { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } }

app.post("/connect", async (req, res) => {
  try {
    const cookie = normalizeCookie(req.body?.cookie);
    if (!cookie) return res.status(400).json({ ok: false, error: "Paste your PointClickCare session cookie." });
    const base = (req.body?.base || "").trim() || undefined;
    setRuntimeCredentials({ cookie, base });
    const v = await validateSession();
    startHeartbeat();
    res.json({ ok: true, who: v.who });
  } catch (e) {
    clearSession(); stopHeartbeat();
    res.status(e.status && e.status < 500 ? 200 : 502).json({ ok: false, error: e.message });
  }
});

app.post("/disconnect", (_req, res) => { clearSession(); stopHeartbeat(); res.json({ ok: true }); });
app.get("/status", (_req, res) => res.json({ connected: hasRuntimeCredentials(), keepAlive: !!heartbeat, lastPing, lastPingOk }));

// status query: "O" Open (default, fast), "" All, "E" Exported, "A" Accepted, "N" Do Not Submit.
app.get("/claims", async (req, res) => {
  try {
    const status = req.query.status ?? "O";
    const claims = await getClaims({ statuses: [status] });
    res.json({ ok: true, claims });
  } catch (e) {
    res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message });
  }
});

// List facilities this login can see.
app.get("/facilities", async (_req, res) => {
  try { res.json({ ok: true, facilities: await getFacilities() }); }
  catch (e) { res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message }); }
});

// Switch the active facility, then report the new current facility name.
app.post("/facility", async (req, res) => {
  try {
    await switchFacility(req.body?.id);
    const v = await validateSession();
    res.json({ ok: true, who: v.who });
  } catch (e) {
    res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message });
  }
});

// Individual claims inside one batch (drill-down).
app.get("/invoices/:batchId", async (req, res) => {
  try {
    const claims = await getBatchInvoices(req.params.batchId);
    res.json({ ok: true, claims });
  } catch (e) {
    res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message });
  }
});

// Every individual claim across all batches, flattened.
app.get("/all-claims", async (req, res) => {
  try {
    const status = req.query.status ?? "O";
    const claims = await getAllClaims({ statuses: [status] });
    res.json({ ok: true, claims });
  } catch (e) {
    res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`PCC claims console on :${PORT}`));
