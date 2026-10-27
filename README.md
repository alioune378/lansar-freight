# LANSAR Freight Shipping Corp: website & operations platform

Phase 1–3 build: the premium public website, a working multi-step quote system, staff-managed shipment tracking, the customer service center, and the owner/staff operations dashboard.

## Run it

Requires **Node.js 22.13 or newer**. No other dependencies. It uses Node's built-in HTTP server, SQLite and crypto.

```bash
cp .env.example .env              # fill in APP_SECRET, email provider, STAFF_NOTIFY_EMAILS
npm run create-admin -- you@lansarfs.com "Your Name" "a-strong-password"
npm start                         # http://localhost:3000   dashboard: /ops
```

Data (database + uploaded documents) lives in `DATA_DIR` (default `./data`). **Back this folder up.**
**Render (recommended):** in Render choose New → Blueprint, pick this GitHub repository, and fill in ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME and STAFF_NOTIFY_EMAILS when asked. `render.yaml` is set to Render's **free plan for demos**: data resets whenever the service restarts, and the owner account is re-created from ADMIN_EMAIL/ADMIN_PASSWORD on each start. For real use, switch to `plan: starter`, enable the disk block, set `DATA_DIR=/var/data`, then remove ADMIN_PASSWORD after the first sign-in. Remove `NOINDEX` when the site goes live on its real domain.

Or deploy with the Dockerfile on any host with a persistent disk (Render, Railway, Fly.io, a VPS). Put it behind HTTPS and set `NODE_ENV=production`.

## What works today

| Area | Routes | Notes |
|---|---|---|
| Public site | `/`, `/services/*`, `/shipping-to/*`, `/about`, `/business`, `/support`, `/contact` | Mobile-first, SEO meta, JSON-LD, sitemap, robots |
| Quote system | `/quote` → `/quote/received/LQ-…` | 5-step wizard (works without JS), mode-specific cargo fields, private document upload, LQ- reference, customer + staff emails |
| Tracking | `/track` | Reference **and** email required. Shows quote status (LQ-) or shipment milestones (LFS-) and shared documents |
| Service center | `/support`, `/contact`, `/business`, `/support/case/LC-…` | Case reference, private signed link, two-way thread, secure document exchange, complaint → auto-escalation |
| Operations | `/ops` | Dashboard KPIs, lead pipeline, quote builder with cost/sell/margin, send quotation email, convert to shipment, milestones (visible/internal, notify), documents, cases, customers, tasks, reports, email log, team & roles |

Roles: **owner** (everything + team management) and **staff**. The schema already includes the `customer` role for the Phase 4 portal.

## Email
Every message is written to the `outbox` table first (view at `/ops/outbox`). Set `MAIL_PROVIDER=resend` or `postmark` with an API key to deliver. Verify the `lansarfs.com` sending domain (SPF/DKIM) with the provider first.

## Content rules built in
- No published rates, transit times, vessel positions, reviews, certifications or carrier affiliations.
- Tracking shows only milestones staff post. ETA fields come from the carrier booking and are labeled as estimates.
- Company facts live in `src/config.js` (`company`, `services`, `destinations`). Edit there.

## Before launch: owner checklist
1. Review all service and destination copy in `src/config.js` and confirm which lanes and services LANSAR offers.
2. Have Privacy and Terms (`/privacy`, `/terms`) reviewed by counsel. They are marked draft.
3. Website images are AI-generated concepts; some show LANSAR-branded trucks/uniforms. Replace with real photography when available.
4. The logo files are raster crops; commission a vector master.
5. Set `PUBLIC_EMAIL` once the public inbox is confirmed.

## Roadmap
- **Phase 4 Customer portal:** accounts, saved quotes, shipment history, booking requests, documents, notifications (users table and customer links are ready).
- **Phase 5 Shipment management:** booking requests from accepted quotes, invoices, carrier API tracking feeds (milestones table accepts automated sources).
- **Phase 6 Growth:** more destination pages, GA4/Plausible conversion goals (`generate_lead` already fires), repeat-shipment shortcuts, CRM sync.
- Scale path: move SQLite → PostgreSQL and local files → S3/R2 when volume requires; the SQL is portable.
