# 05 — AI Marketing (CRM): research and design

AI Marketing is the guest/customer layer of AI Manager. HR answers "is my team doing the job?". AI Marketing answers "are my guests coming back, and did what I did about it make money?"

**Positioning:** we are not trying to have more CRM features than the big platforms. The goal is to make **retention and revenue growth measurable, automatic and affordable** for small Philippine venues, and to work for staff who will never read a manual.

---

## 1. What we took from each reference platform

| | SevenRooms | Square (Loyalty + Customer Directory) | GoHighLevel |
|---|---|---|---|
| **Their strength** | Guest intelligence for hospitality: auto-built profiles, rules-based **auto-tags** ("VIP", "Big spender", "Wine lover"), lifetime and itemised spend from 65+ POS integrations, VIP arrival alerts to staff | **Phone number = loyalty ID**. Enrol at checkout in seconds, one earn rule (per visit / per item / per ₱), points accrue automatically, cash purchases count too, almost no staff effort | Marketing automation for agencies: workflows, reusable **snapshots** (a full account setup cloned to new clients), white-label **SaaS mode** with Stripe billing and SMS/email re-billing |
| **What we built from it** | Guest profile with spend, rhythm, preferences, **auto-tag rules**, tiers, a one-line **recognition** string for door/bar staff, reservations vs minimum consumable, VIP-host and promoter attribution | **Counter check-in**: type the mobile number, the amount, done. Returning guests are recognised instantly. Single earn rule, rewards, FIFO point expiry, idempotent receipt numbers | **Playbooks** (our snapshots): nightclub VIP, café loyalty, shisha lounge. Each sets loyalty, tiers, tags and automations in one click. **Automations**: welcome, VIP thank-you, birthday, VIP gone quiet, win-back, reward unlocked |
| **What we did differently** | Their CRM is tied to their reservation product and priced by booking volume. Ours is free-standing and works for walk-in retail too | Square's loyalty is priced per loyalty visit and needs Square POS. Ours accepts any POS through one webhook | We did **not** copy GHL's feature sprawl. Every campaign has a **holdout group**, so the owner sees *proven* lift, not "messages sent" |

GoHighLevel's business model (agency → white-label SaaS → client sub-accounts) fits AI Manager's distribution: a reseller/agency can run many venues from one platform, with a playbook as the onboarding template. Multi-tenancy is already in place (`tenant_id` on every row). White-label branding and plan billing are on the roadmap, not built.

## 2. Philippine requirements and how they are handled

| Requirement | Finding | In the product |
|---|---|---|
| **Data Privacy Act (RA 10173) — consent** | NPC Circular 2023-04 (Guidelines on Consent) does not accept silence, pre-ticked boxes or inactivity as consent, and NPC advisories reject "soft opt-in". Direct marketing on non-sensitive data *may* use legitimate interest after a documented legitimate-interest assessment (Circular 2023-07). Sources conflict on how far that goes, so the product takes the safe path. | Marketing goes **only** to guests with a recorded opt-in per channel. The consent box is never pre-ticked. Every grant/withdrawal is stored append-only in `crm_consent_events` with the exact wording, wording version, source, staff user and IP. Transactional messages (booking confirmation) are allowed without marketing consent. |
| **Right to object / opt-out** | Telcos confirmed to the NPC that subscribers can opt out of promotional SMS. | Every marketing SMS gets the business name and "Reply STOP to opt out". The inbound webhook recognises STOP, UNSUBSCRIBE, HINTO, ITIGIL, "ayoko na", and withdraws SMS consent automatically. |
| **Access, portability, erasure (Sec. 16–18)** | — | Admin can export one guest's data as JSON, and erase it. Erasure wipes name, mobile, email, birthday, preferences, tags and message text. Sales amounts stay as anonymous history for the books. Export and erase are audited without copying personal data into the audit log. |
| **Data minimisation and retention** | — | Birthday is stored as MM-DD (no year). A retention setting (default 3 years) flags inactive profiles for review. The AI assistant's tools never return phone numbers. |
| **SMS sender ID (NTC)** | Sender IDs must be registered, with requirements differing per network, often a Letter of Authorization, taking 2–4 weeks. Twilio reports unregistered sender IDs blocked from 7 Apr 2025. | Sender name is a setting (max 11 characters). The provider defaults to **log** (simulated) until a registered sender and API key are configured. |
| **SMS cost** | Semaphore lists ₱0.50–0.56 per SMS part (ex-VAT); a part is 160 GSM characters, but **70** when the text has any Unicode character (emoji, "₱"). | The campaign builder counts parts live and warns about Unicode. Cost is estimated before sending and recorded per message. |
| **Viber / Messenger** | Viber Business Messages to PH ≈ USD 0.0046/message plus platform fees (e.g. USD 0.005/msg via Alibaba Cloud, or a ~USD 200/month minimum). Messenger pricing for PH was not found. | Channel model supports `sms`, `viber`, `email`, `messenger` with consent per channel. Only the SMS adapter (Semaphore) is implemented. |
| **Local POS** | StoreHub, UTAK, Mosaic and Loyverse are common. No public customer/loyalty APIs were found for them in this research; delivery and accounting integrations exist. | One generic, idempotent webhook (`POST /api/crm/pos/transactions`, device token) any POS or middleware can call, plus CSV import. The AI Manager POS order slips can feed it directly. Vendor-specific connectors still need to be confirmed with each vendor. |
| **Phone numbers** | Mobile numbers are portable (MNP Act, RA 11202), so prefixes do not reveal the network. | Every input form ("0917…", "9171…", "+63 917…", "63917…") is normalised to E.164 `+639XXXXXXXXX`, unique per venue. Landlines are rejected for messaging. Foreign numbers are accepted when written with "+". |
| **Non-technical staff** | — | Counter screen with an on-screen keypad. Recognition in one sentence ("Gold · VIP · 7 visits · last 25d ago · avg ₱24,671 · likes Don Julio 1942"). Consent wording shown as a script to read aloud. No setup beyond picking a playbook. |

## 3. Making retention measurable

- **RFM segments** with fixed thresholds (not quantiles, so a 200-guest venue gets stable segments): Champions, Loyal, Can't lose, At risk, New, Promising, Need attention, Hibernating, Lost, No visits yet. Each has a plain-language next action and a "Message this segment" button.
- **Overdue detection**: a regular whose current absence is more than 2× their own median gap between visits (minimum 14 days). This is the "VIP slipping away" list, sorted by 12-month spend.
- **Cohort retention**: the share of each month's first-time guests who came back within 30/60/90 days.
- **Campaign lift against a holdout.** A deterministic hash keeps a percentage of the eligible audience (default 10%) un-messaged. After the attribution window (default 14 days) the system compares return rate and ₱ per guest, then reports lift in percentage points, incremental revenue, cost and ROI. A one-sided two-proportion z-test labels the result **Proven** (≈95%), **Likely** (≈80%), **Unclear**, or **No lift**, and groups under 5 are "too small to measure". The owner never sees a vanity "34% came back" without the comparison.
- **Identified-revenue share**: guest revenue as a share of all closed order slips. This shows how much of the business the CRM can actually see.

## 4. A separate app

The CRM is its own product, separate from HR and from the POS. It lives at `/crm` with its own sign-in, menu, customer search and gold-on-black "data board" theme (`web/src/crm/crm.css`). The HR app only links to it from the profile menu. `VITE_APP=crm` builds the CRM on its own (`npm run build:demo-crm` → `web/dist-demo-crm/ai-marketing-crm.html`). The backend stays one API with the same tenants and users, so a venue signs in once with the same account.

Screens: **Command center**, **Customer database**, **Spending performance**, customer profile (with spending per visit), Tonight & tables, Counter check-in, Campaigns, Automations, Settings.

**Spending performance** (`GET /api/crm/spending?days=30|90|180|365&tier=&segment=`, pure `spendingPerformance()` in `core.ts`): revenue, customers, spend per customer, average ticket and change vs the previous period; customers kept, lost and new; top-10% / top-20% revenue share with a Pareto curve; customers per spend band; revenue by tier and segment; category mix with the average ticket on visits that included it; business-night × hour heat map; frequency × ticket scatter; biggest growers and decliners; top-25 leaderboard.

## 5. Architecture

Same pattern as payroll: a **pure engine** plus thin services.

```
server/src/crm/
  phone.ts      PH number normalisation / formatting / masking
  engine.ts     stats, tiers, auto-tags, RFM, loyalty + FIFO expiry, consent rules, templates, SMS parts,
                audiences, holdout, lift + significance, cohorts, automation triggers   (pure, unit-tested)
  playbooks.ts  nightclub_vip · cafe_loyalty · shisha_lounge, defaults, merge
  core.ts       composes the engine over plain rows: profiles, overview, recognition, campaign results,
                automation planning, DSR export, erasure fields          (shared by API and browser demo)
  service.ts    Postgres loading, find-or-create guest, record visit (+points, tier multiplier), redeem
                (advisory lock), consent events, sending, hourly automation loop + point expiry
  messaging.ts  provider interface: log (simulated, default) · semaphore (real SMS)
  sample.ts     deterministic sample guests for the demo venue
server/src/modules/crm.routes.ts   /api/crm/*
web/src/marketing/                 Dashboard · Guests · Guest profile · Counter · Tonight & tables
                                   Campaigns · Automations/Outbox · Marketing settings
web/src/demo/crm.ts                same API in the browser for the no-server demo
```

**Tables** (migration `0006_crm_marketing`): `crm_customers`, `crm_consent_events`, `crm_visits`, `crm_points`, `crm_reservations`, `crm_campaigns`, `crm_messages`, `crm_automations`. Settings live in `tenants.settings.crm`.

**Links to the HR layer:** reservations carry the VIP host and promoter (employees), visits carry the server, and guests carry "brought by". The *Who brings the guests* table (bookings, show-up rate, new guests, table spend vs minimum) feeds table and guestlist commissions. The AI Manager chat has read-only CRM tools (`get_crm_overview`, `find_guests`, `get_campaign_results`) next to the HR tools.

**Scale note:** profiles are computed in memory per request from the tenant's rows. This is simple and fast for pilot venues (thousands of guests, tens of thousands of visits). Past roughly 50k visits per tenant, move the aggregation into SQL views or materialised tables. The engine API does not change.

**Safety defaults:** the SMS provider defaults to `log`; quiet hours are 21:00–09:00 for automations and campaigns (an admin can override per send); there is at most one automated message per guest per day; "reward unlocked" fires only right after a visit, so turning it on does not text the whole back catalogue; a campaign is claimed atomically before sending, so a double-click cannot send twice; and repeated POS receipts are ignored.

## 6. API summary

| Area | Endpoints |
|---|---|
| Setup | `GET/PUT /api/crm/settings`, `POST /api/crm/playbooks/:key/apply` |
| Insight | `GET /api/crm/overview`, `GET /api/crm/spending?days&tier&segment`, `GET /api/crm/customers?q&segment&tag&tier&sort&limit`, `GET /api/crm/customers/:id`, `GET /api/crm/attribution` |
| Counter | `GET /api/crm/lookup?phone=`, `POST /api/crm/checkin`, `POST /api/crm/customers/:id/redeem` |
| Guests | `POST /api/crm/customers`, `PATCH /api/crm/customers/:id`, `POST …/consent`, `POST …/visits`, `POST …/points` (admin, reason), `GET …/export` (admin), `POST …/erase` (admin, reason) |
| Tables | `GET/POST /api/crm/reservations`, `PATCH /api/crm/reservations/:id` (closing a table with the bill records the visit and points once) |
| Campaigns | `POST /api/crm/campaigns/preview`, `GET/POST /api/crm/campaigns`, `GET/DELETE /api/crm/campaigns/:id`, `POST /api/crm/campaigns/:id/send` (admin) |
| Automations | `GET /api/crm/automations`, `PATCH /api/crm/automations/:id`, `POST /api/crm/automations/run`, `GET /api/crm/messages` |
| Integrations | `POST /api/crm/pos/transactions` (device token), `POST /api/crm/import` (admin; consent only with evidence text), `POST /api/crm/inbound/sms?key=` (STOP replies) |

Environment: `SMS_PROVIDER=log|semaphore`, `SEMAPHORE_API_KEY`, `CRM_INBOUND_SECRET`, `CRM_AUTOMATIONS=on|off`.

## 7. Pilot plan: one architecture, two workflows

| | Pilot A — Nightclub VIP (high-touch) | Pilot B — Café / shisha lounge (high-frequency) |
|---|---|---|
| Playbook | `nightclub_vip`: ₱100 = 1 pt, tiers by 12-month spend (Silver ₱30k, Gold ₱100k, Black ₱300k) | `cafe_loyalty` (1 stamp per ₱120+ visit, free drink at 9) or `shisha_lounge` (₱50 = 1 pt) |
| Daily use | Tonight & tables (VIP host at the door), close table with bill, promoter attribution | Counter check-in on every bill; redeem at the counter |
| Key automations | VIP thank-you, VIP gone quiet, birthday table invite | Welcome, reward unlocked, regular skipped their routine |
| Success metrics (8 weeks) | ≥80% of table bills linked to a profile · no-show rate down · VIP overdue list contacted weekly · one proven-lift win-back campaign | ≥40% of bills identified · ≥50% of new guests opted in · 30-day return rate of new guests up vs the first cohort · one proven-lift campaign |
| What it validates | Recognition + attribution are worth the staff effort | Enrolment is fast enough that cashiers actually do it |

Run both on the same deployment and code path. If both pilots meet their metrics, one CRM architecture serves both high-touch hospitality and high-frequency retail.

## 8. Open validation questions (before scaling)

1. **POS:** will StoreHub / UTAK / Mosaic push bills (webhook or export), or do we need a middleware or CSV routine per venue?
2. **Sender ID:** registration lead time and Letter of Authorization per network for each venue's brand; Viber Business account cost vs SMS for the target guests.
3. **Consent basis:** have counsel confirm consent-only marketing (current default) against a documented legitimate-interest assessment under Circular 2023-07, and review the consent wording.
4. **Staff:** time per check-in at the counter at peak hours (target < 10 s), and whether door staff use the recognition line.
5. **Holdout acceptance:** will owners accept not messaging 10% of guests? Without it, lift cannot be proven.

## 9. Roadmap

1. Viber Business Messages and email adapters; delivery receipts.
2. Guest-facing pages: a self-enrolment QR code at tables (consent captured by the guest), points balance by SMS keyword.
3. Scheduled campaigns and A/B variants (two templates, same holdout).
4. AI Marketing assistant: proposes the week's campaign (segment, message, expected lift) from the dashboard, with the owner approving the send.
5. White-label / agency mode (GoHighLevel model): reseller branding, playbook marketplace, per-tenant plan billing and SMS re-billing.
6. SQL-side aggregation for large tenants; Postgres RLS.

## Sources

- SevenRooms CRM and segmentation: https://sevenrooms.com/platform/crm/ · https://sevenrooms.com/en/guest-data-profiles/ · https://sevenrooms.com/blog/12-features-to-look-for-in-a-membership-club-crm/
- Square Loyalty: https://squareup.com/help/gb/en/article/5744 · https://squareup.com/help/ca/en/article/6462 · https://square.com/help/au/en/article/3952-create-a-loyalty-program-with-square · https://squareup.com/au/loyalty
- GoHighLevel pricing and SaaS mode: https://www.gohighlevel.com/how-much-is-go-high-level · https://gohighlevelassist.freshdesk.com/support/solutions/articles/48001184920-saas-mode-full-setup-guide-faq · https://www.webdew.com/blog/gohighlevel-saas-mode
- NPC consent / legitimate interest: https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/asia-pacific/philippines/topics/cookies-online-tracking-and-direct-marketing · https://insightplus.bakermckenzie.com/bm/data-technology/philippines-national-privacy-commission-issues-guidelines-on-the-processing-of-personal-information-based-on-legitimate-interest · https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf · https://digitalpolicyalert.org/event/15573-adopted-national-privacy-commission-guidelines-on-consent-circular-no-2023-04
- SMS in the Philippines: https://www.semaphore.co · https://api.semaphore.co/docs · https://www.twilio.com/en-us/guidelines/ph/sms · https://www.infobip.com/docs/essentials/asia-registration/philippines-letter-of-authorization-loa-guidelines.md · https://newsinfo.inquirer.net/1500049/sms-pol-ads-need-users-consent
- Viber pricing: https://www.alibabacloud.com/help/en/chatapp/product-overview/viber · https://cpaas.8x8.com/en/blog/rakuten-vibers-new-business-messaging-rates-8x8-viber-for-business-api/
- PH POS landscape: https://www.storehub.com/ph/blog/storehub-vs-utak · https://www.storehub.com/ph/blog/storehub-vs-loyverse · https://klikit.io/en/learn/ph-cafe-pos

Most platform claims come from vendor pages, and several regulatory summaries come from law-firm or vendor secondary sources. Verify pricing and the NPC circular texts before commercial or legal decisions.
