// Holds the PointClickCare session IN MEMORY ONLY. Never written to disk or the repo.
// PCC is a JSF/PrimeFaces app, so the "session" is the browser cookie string from a
// logged-in PCC tab (JSESSIONID plus whatever else PCC sets). We keep it flexible: the
// user pastes the raw Cookie header and we send it back verbatim on each request.

let runtime = null; // { cookie, base }

export function setRuntimeCredentials({ cookie, base } = {}) {
  if (!cookie) throw new Error("A PointClickCare session cookie is required.");
  runtime = { cookie: cookie.trim(), base: base || process.env.PCC_BASE_URL || "https://login.pointclickcare.com" };
}

export function hasRuntimeCredentials() {
  return !!(runtime && runtime.cookie);
}

export function getSession() {
  if (runtime && runtime.cookie) return runtime;
  const envCookie = process.env.PCC_COOKIE;
  if (envCookie) return { cookie: envCookie.trim(), base: process.env.PCC_BASE_URL || "https://login.pointclickcare.com" };
  throw new Error("Not connected. Paste your PointClickCare session first.");
}

export function clearSession() {
  runtime = null;
}
