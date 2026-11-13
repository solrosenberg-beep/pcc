# PointClickCare Claims Console — Project Handoff

> Paste this whole file into a new chat to give Claude full context. Last updated: 2026-11-13.

---

## 1. What this project is

A read-only API + dashboard over **PointClickCare (PCC)**, focused on **claims**. It logs
into a live PCC session (via a pasted browser cookie), pulls the UB-04 claim batches and the
individual claims inside them, and shows them in a clean dashboard styled to match the
Stampli/Zunta console (orange accent, traffic-light status).

**It is read-only** — it never writes, submits, or changes anything in PCC. It is a separate
project from Stampli and the Pyle dashboard; never mix them.

---

## 2. Repo & environment

- **GitHub:** `solrosenberg-beep/pcc` (private)
- **Default branch:** `main`
- **Deploy on Replit:** import the GitHub repo, run as **Autoscale** (NOT Static — Static 404s
  with "no previewable artifacts" because this is a Node server). Set Sharing to **Private** (PHI).
- **Stack:** Node 20, Express 5, ESM (`.mjs`). No browser/Playwright needed — pure `fetch`.

---

## 3. The files

| File | Purpose |
|------|---------|
| `src/server.mjs` | Express server. Serves `console/`. Endpoints: `/connect`, `/status`, `/disconnect`, `/claims`, `/invoices/:batchId`, `/all-claims`. |
| `src/pcc.mjs` | PCC client. Parses UB-04 batch list + per-batch invoices from server-rendered HTML. Sends full browser-like headers (critical — see §5). |
| `src/session.mjs` | Session held **in memory only**. Default host `https://www28.pointclickcare.com` (override per org). |
| `console/index.html` | The dashboard (Stampli look): login gate, Batches tab, All-claims tab, drill-down drawer, Upload 837. |
| `.replit`, `.gitignore`, `package.json` | Config. Secrets/HAR/exports git-ignored. |

---

## 4. How it works

PCC is a **JSF/JSP app** (not a clean JSON API), so claims come back as server-rendered HTML
that we parse. Two levels:

1. **Claim batches** — `GET /admin/billing/ub04batchlist.jsp?ESOLrow=<n>&ESOLview=default&ESOLstatus=<s>&ESOLsubmitterfilterid=-1`
   - Columns parsed: Batch #, Date, Description, Payer (submitter profile), Status, Claims count, Batch Total.
   - Each row has an `ESOLbatchId` for drill-down.
   - **Pagination:** 20 rows/page; `ESOLrow` = 1, 21, 41, … Stop when a page returns < 20 rows.
   - **Status codes (`ESOLstatus`):** `""` = All (default), `O` = Open, `E` = Exported, `A` = Accepted, `N` = Do Not Submit.
2. **Individual claims in a batch** — `GET /admin/billing/ub04batchinvoices.jsp?ESOLbatchId=<id>`
   - Columns parsed: Resident (name + client id), Payer, Type, Bill Type, From, To, Amount; each has an `ESOLinvoiceid`.

The dashboard: **Batches** tab (summary), click a batch → **drawer** with its claims,
**All claims** tab (flat list across every batch — one request per batch, so it's lazy/slower).

---

## 5. The critical fix (do not regress)

A bare server `fetch` with just the cookie returned **HTTP 403** — PCC's anti-bot/WAF
(DataDome / Cloudflare `cf_clearance` / Incapsula) rejects requests that don't look like a
browser. **The fix:** `src/pcc.mjs` sends a full browser header set — `user-agent` (real Chrome),
`referer`, `accept-language`, `sec-ch-ua*`, `sec-fetch-*`, `upgrade-insecure-requests`. With
those, PCC returns the data (403 → 200). If it starts 403-ing again, re-check these headers and
the User-Agent (override with `PCC_USER_AGENT`).

- **302** (vs 403) = the cookie is incomplete / expired → re-paste a full fresh cookie.

---

## 6. How you log in (there is no password screen)

PCC blocks automated login (SMS/SSO + anti-bot), so you hand the app your already-logged-in
session instead:

1. Log into PCC in a browser. F12 → **Network** → reload → click a `www28.pointclickcare.com`
   request → **Request Headers** → copy the **entire `Cookie:`** value (turn on "Raw").
2. In the app: keep host `https://www28.pointclickcare.com`, paste the cookie, **Connect**.
3. The cookie is saved **in that browser only** (prefills next time). Re-paste when it expires.

The full cookie must include the auth cookies (JSESSIONID, sopsession, WeToken, XSRF-TOKEN,
last_org, …) — a single value won't authenticate. Copying from **Application → Cookies** gives
one at a time and hides HttpOnly ones; use **Network → Request Headers → Cookie** instead.

---

## 7. Features

- **Batches** tab — batch #, description, payer, date, claims count, amount, status (traffic-light).
- **All claims** tab — flat list of every individual claim (resident, payer, batch, bill type, dates, amount).
- **Drill-down drawer** — click a batch to see its claims.
- **Status filter** — All / Open / Exported / Accepted / Do Not Submit.
- **Upload 837** — read-only: parses an X12 837 file and previews the claims on screen. **Never submitted to PCC.**

---

## 8. Security constraints (MUST preserve)

- Data is **HIPAA-covered PHI** (patient names, claim amounts, payers). Treat exports as PHI.
- The pasted session lives **in server memory and the user's browser only** — never in the repo.
- Cookies, HAR captures, exports are git-ignored.
- The app only **reads** from PCC. It never submits/writes.
- To actually **submit claims**, use PointClickCare's **official API** (OAuth, validation, audit) —
  not this scraper. Writing claims to a live EHR by replaying requests risks duplicate/malformed
  billing to Medicare/Medicaid.
- Deploy **Private**. Each person connects with **their own** PCC cookie.

---

## 9. Known limitations / open items

- **Cookie expires** — re-paste a fresh one when loading stops.
- **Anti-bot could change** — if PCC tightens its WAF, the header approach may need updating.
- **All-claims view is slow** with many batches (one request per batch).
- **Remittances** not built yet — in PCC that's the **Cash Receipts / payments** screen
  (`batchlist.jsp?ESOLview=Cash Receipts`); needs a HAR capture of that screen to wire, same as claims.
- **Org host** defaults to `www28`; other orgs use a different number (configurable on the login screen / `PCC_BASE_URL`).

---

## 10. Quick start

```bash
npm install
npm start          # serves on PORT (default 3000)
```

Open the app → paste your PCC cookie → Connect → claims load. To update the deployed app, push
to `main` and have Replit pull (`git fetch origin && git reset --hard origin/main`), then redeploy.
