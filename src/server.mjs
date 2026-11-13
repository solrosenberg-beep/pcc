// Express server for the PCC claims console. Serves the login-gated dashboard and a
// small read-only API. Credentials live in memory only (see session.mjs).

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setRuntimeCredentials, clearSession, hasRuntimeCredentials } from "./session.mjs";
import { validateSession, getClaims, getBatchInvoices, getAllClaims, PccError } from "./pcc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "..", "console")));

// Clean a pasted cookie header: strip newlines/quotes, collapse whitespace.
function normalizeCookie(raw) {
  if (!raw) return "";
  return String(raw).replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().replace(/;$/, "");
}

app.post("/connect", async (req, res) => {
  try {
    const cookie = normalizeCookie(req.body?.cookie);
    if (!cookie) return res.status(400).json({ ok: false, error: "Paste your PointClickCare session cookie." });
    const base = (req.body?.base || "").trim() || undefined;
    setRuntimeCredentials({ cookie, base });
    const v = await validateSession();
    res.json({ ok: true, who: v.who });
  } catch (e) {
    clearSession();
    res.status(e.status && e.status < 500 ? 200 : 502).json({ ok: false, error: e.message });
  }
});

app.post("/disconnect", (_req, res) => { clearSession(); res.json({ ok: true }); });
app.get("/status", (_req, res) => res.json({ connected: hasRuntimeCredentials() }));

app.get("/claims", async (_req, res) => {
  try {
    const claims = await getClaims();
    res.json({ ok: true, claims });
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
app.get("/all-claims", async (_req, res) => {
  try {
    const claims = await getAllClaims();
    res.json({ ok: true, claims });
  } catch (e) {
    res.status(e instanceof PccError && e.status ? e.status : 502).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`PCC claims console on :${PORT}`));
