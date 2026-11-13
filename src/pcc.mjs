// Read-only client for a logged-in PointClickCare session — CLAIMS only.
//
// IMPORTANT: PCC's internal endpoints are not public and differ by module/version.
// Unlike Stampli (clean JSON-RPC), PCC is JSF/PrimeFaces: claim/billing data usually
// comes back as server-rendered HTML pages, PrimeFaces partial-AJAX responses, or a
// report/export URL (CSV/Excel). The exact URLs + parameters must be MAPPED FROM A REAL
// NETWORK CAPTURE (HAR) of a logged-in PCC session. The functions below are the shape of
// the client; the marked spots get filled in once we have that capture.

import { getSession, clearSession } from "./session.mjs";

export class PccError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// Authenticated GET against PCC using the pasted session cookie.
export async function pccGet(path, { headers = {} } = {}) {
  const { cookie, base } = getSession();
  const url = path.startsWith("http") ? path : base.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json,*/*",
      "user-agent": "Mozilla/5.0 (pcc-console)",
      cookie,
      ...headers,
    },
  });
  // PCC bounces unauthenticated requests to the login page (302 or a login form in the body).
  if (res.status === 302 || res.status === 401 || res.status === 403) {
    clearSession();
    throw new PccError(`PointClickCare session is not valid or has expired (HTTP ${res.status}).`, { status: res.status, url });
  }
  const text = await res.text();
  if (/userLogin\.xhtml|name=["']loginForm["']/i.test(text)) {
    clearSession();
    throw new PccError("PointClickCare returned the login page — the session is not valid.", { status: res.status, url });
  }
  return { status: res.status, text, url };
}

// Validate the pasted session by hitting an authenticated landing page.
// TODO(capture): replace with the real post-login landing URL from the HAR.
export async function validateSession() {
  const { text } = await pccGet(process.env.PCC_HOME_PATH || "/home/userLogin.xhtml");
  // A valid session should NOT show the login form (handled in pccGet). Pull a display name if present.
  const m = text.match(/<[^>]*class=["'][^"']*user[^"']*["'][^>]*>([^<]{2,60})</i);
  return { ok: true, who: m ? m[1].trim() : null };
}

// Pull the claims list.
// TODO(capture): wire to the real PCC claims/AR endpoint (likely a billing report or
// a PrimeFaces data-table partial). Parse rows into the normalized shape below.
export async function getClaims() {
  // Placeholder until the capture is in. Normalized row shape the console expects:
  //   { id, resident, payer, dos, amount, status }
  throw new PccError(
    "Claims endpoint not wired yet — send a HAR capture of the PCC billing/claims screen so the real URL can be mapped.",
    { status: 501 }
  );
}
