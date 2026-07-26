# UI/UX Audit Report — P2P UPI Gateway

**Scope:** All 5 frontend surfaces — admin (5173), trader (5174), merchant (5175), checkout (5176), and the Android APK ("MaxPay", `com.example.paymentbot`).
**Method:** Read-only source audit of every router + every page/screen component. No files were modified.
**Screenshots:** No browser/Playwright tool was available in this environment and the deliverable is documentation only, so each screen is described in text precise enough to picture it. (`./ui-audit-screenshots/` was intentionally *not* created.)

**Legend used throughout:**
- **Token-based** = uses the `.tf-scope` CSS variables (`var(--card)`, `var(--text)`, `var(--accent)`, etc.) and therefore respects the light/dark toggle.
- **Hardcoded-dark** = uses raw Tailwind `gray-800/900/950`, `text-white`, etc. — renders permanently dark even though every panel defaults to **light**, so these areas look wrong on the live light background.
- **Live** = wired to a real API; **Mock/empty** = reads `utils/mock.js` (all arrays are emptied to `[]`); **Dead/fake** = a control that does nothing or only mutates local state.

---

# 1. Admin Panel (5173)

Router `frontend/admin/src/App.jsx`. Accent token = red `#ef4444`. Shell = `AdminLayout` (sidebar + slim header) inside `.tf-scope`. **`utils/mock.js` is fully emptied** — every seed array is `[]`, so only API-wired pages show data. Two styling regimes coexist: **token-based** (Dashboard, Payouts) vs **hardcoded-dark** (everything else).

### Page: Admin / Login (`/login`)
- **Layout:** Standalone centered column (no shell, not in `.tf-scope`). Logo tile, "Admin Console" heading, form card, demo-mode hint, footer.
- **Components used:** None of `ui.jsx` — 100% custom inline inputs/buttons + inline spinner SVG.
- **Key visual elements:** Logo, email input, password input w/ Show/Hide, submit w/ spinner, error banner, "any email/password signs you in" demo notice.
- **Colors/tokens used:** Zero tokens; ~30 hardcoded classes, all dark-assuming (`bg-gray-950/900/800`, `text-white`, `text-gray-300/400/500`). Uses `bg-red-600` (#dc2626) for logo/button — **differs from the console accent `#ef4444`**.
- **Data displayed:** None (auth form). Falls back to mock login on network error.
- **Interactive elements:** Email/password, Show/Hide, Sign-in (functional). No dead controls.
- **Inconsistent:** The only page that never responds to the theme toggle; off-accent (`red-600` vs `#ef4444`); no shared primitives.

### Page: Dashboard (`/dashboard`)
- **Layout:** `PageHeader` → `.tf-grid` of 6 StatCards → charts row (VolumeChart spans 2, DonutChart 1) → Top-Traders/Top-Merchants lists → full-width "Live Transaction Feed" table.
- **Components used:** `Card`, `StatCard`, `Badge`, `PageHeader`, `InlineLoader` (shared) + custom inline `VolumeChart` and `DonutChart`.
- **Key visual elements:** 6 KPI cards, 7-day bar chart, success/failed donut, ranked lists, animated live-feed table with ping dot.
- **Colors/tokens used:** Mostly token-based; charts hardcode ~15 Tailwind color utilities (`from-red-600/40`, `text-emerald-500`, etc.); StatCard trend inline `#22c55e`/`#ef4444`.
- **Data displayed:** StatCards **live** (`adminApi.dashboard()`). Everything else **mock/empty**: `volume7Days=[]`, donut `{0,0}`, top lists `[]`. **The live feed is a fake `setInterval` simulation.**
- **Interactive elements:** Chart hover tooltips only.
- **Inconsistent:** One of the two theme-correct pages. **Runtime hazard:** the feed simulation indexes empty `merchants`/`traders` arrays (`seed % 0 = NaN`) → throws every 3.5s; `VolumeChart` gets `Math.max(...[]) = -Infinity`. Charts render empty.

### Page: Traders (`/traders`)
- **Layout:** `PageHeader` (Add) → filter Card → 10-col table + Pagination. Six modals (view xl, Balance, Edit, Commission, Add, Credentials).
- **Components used:** `Card`, `Badge`, `Button`, `SearchInput`, `Select`, `Pagination`, `PageHeader`, `Modal`, `Field`, `Input`, `InlineLoader`; custom `RowMenu` (portal), `DepositTypesField/Badges`.
- **Key visual elements:** Trader table (balance, commission, deposit types, presence pill, ✎ menu); rich view modal (earnings grid, banks, phones, tx); Commission modal with **live per-100-INR profit preview**; Add w/ password generator; one-time credentials modal.
- **Colors/tokens used:** **Hardcoded-dark, ~70–90 classes** (`text-gray-*`, `bg-gray-800/900/950`, `border-gray-800`, `divide-gray-800`) + semantic `text-emerald-400`/`red-400`/`sky-400`.
- **Data displayed:** **Live** (`adminApi.listTraders()`). But `successRate` hardcoded `100`; `joinedAt/phone/bankAccounts/smartphones/earnings` stubbed → view-modal Earnings/Banks/Phones/Transactions always empty.
- **Interactive elements:** Add / Edit balance / Edit commercial (validated) / Edit details / Suspend / online toggle — all functional. **Dead:** view-modal "Reset password" & "Add balance" (no `onClick`).
- **Inconsistent:** Uses a ✎-portal row menu; Merchants uses a `⋯` dropdown — two idioms. Dark tables on light theme.

### Page: Merchants (`/merchants`)
- **Layout:** `PageHeader` (Add) → filter Card → 8-col table + Pagination. Modals: view xl, Edit Fees, Add, Credentials.
- **Components used:** Same shared set as Traders; custom `Secret` (masked reveal), `RowMenu` (dots).
- **Key visual elements:** Merchant table (API key masked, balance, pay-in/out %, inline Edit-Fees + dots menu); view modal (API creds show/hide/copy); Add w/ password generator.
- **Colors/tokens used:** **Hardcoded-dark, ~50–60 classes.**
- **Data displayed:** **Live** (`adminApi.listMerchants()`). `totalVolumeInr/revenueUsdt` hardcoded `0`; `apiSecret` always bullets; modal volume/revenue/created/tx are placeholder.
- **Interactive elements:** Add Merchant / Edit Fees / Secret show-copy functional. **Dead/local-only:** RowMenu "Edit" & "Set commission" → `() => {}`; modal "Set commission" no `onClick`; Deactivate/Activate + Regenerate API key mutate **local state only** (no API); unused `localAdd()`.
- **Inconsistent:** Row-action dropdown uses `absolute top-8` (clippable) vs Traders' portal — same problem solved two ways.

### Page: Orders (`/orders`)
- **Layout:** `PageHeader` → search Card → Tabs + 9-col table + Pagination. Detail modal (xl).
- **Components used:** shared set + custom `CopyId`, `DepositBadge`, `OrderActions`, `OrderModal`, `STATUS_META`.
- **Key visual elements:** 8 v2 status tabs w/ counts; table (Gateway ID, Merchant, Customer, Amount INR+USDT, Type badge, Trader, Created, Status, per-row actions); modal w/ field grid, same-amount-lock banner, Order Timeline, Payment-Detection confidence bar + engine badges, raw-SMS `<pre>`, manual-override Select+Apply.
- **Colors/tokens used:** **Hardcoded-dark, ~45–55 classes** + own `STATUS_META` map.
- **Data displayed:** **Live** (`adminApi.listOrders()`, refetch on `order:update`). Timeline synthesized (one node); `confidence=null`/`engines=[]`/`rawSms=null` always → Payment Detection always "No payment detected."
- **Interactive elements:** Review/Confirm/Reject/Dispute + manual Override + CopyId — all functional. No dead controls.
- **Inconsistent:** Modal override state inits to `'confirmed'` but options are `success/failed/rejected/disputed` (no `confirmed`) — label/state mismatch. Two status vocabularies coexist (v2 vs legacy `orderApi.confirmOrder`). Most complete real page alongside Payouts.

### Page: Payments (`/payments`)
- **Layout:** `PageHeader` (Export CSV) → 7-control filter Card → 9-col notification-log table + Pagination.
- **Components used:** shared set; custom raw `<input type="date">`, `engineColor` map, `toCsv`.
- **Key visual elements:** Notification-log table (ID, Time, Trader+masked UPI, Merchant, Amount, Method badge, Captured-By engine, Txn ID, Status).
- **Colors/tokens used:** **Hardcoded-dark, ~20 classes.** Date inputs fully hardcoded `border-gray-700 bg-gray-800 … [color-scheme:dark]` — permanently dark.
- **Data displayed:** **100% mock/empty, NOT wired to any API.** Filter dropdowns built from empty arrays → only "All". Table always empty.
- **Interactive elements:** Filters (over empty data); Export CSV (header-only download). No detail view.
- **Inconsistent:** Only list page with **no API integration at all**; bespoke hardcoded date inputs; no loading state.

### Page: Payouts (`/payouts`)
- **Layout:** `PageHeader` → error banner → single Card w/ Tabs + tab-dependent columns table. No pagination.
- **Components used:** `Card`, `Badge`, `Button`, `Tabs`, `PageHeader` (all shared).
- **Key visual elements:** 6 status tabs w/ live counts; conditional columns (Rate base→payout, Trader credit; Reason on dispute); per-row actions that change by tab (Approve & settle / Reject / Settle / Void).
- **Colors/tokens used:** **Token-based** — the second theme-correct page. `var(--muted/text/cardborder)` + inline `#22c55e`, `#ef4444`.
- **Data displayed:** **Live** (`adminApi.listPayoutRequests`, refetch on `order:update`). Real counts/rates/credits.
- **Interactive elements:** Approve & settle / Reject / dispute Settle-Void — all functional. No dead controls.
- **Inconsistent:** Manages its own loading/error state imperatively instead of `useApi`; uses inline-style borders vs sibling `border-gray-800`.

### Page: Disputes (`/disputes`)
- **Layout:** `PageHeader` → Card w/ Tabs + 8-col table. No pagination. Detail modal (lg).
- **Components used:** shared set + custom `DisputeModal`, raw `<textarea>`.
- **Key visual elements:** Open/Reviewing/Resolved tabs; dispute table; modal w/ field grid, dashed **Evidence/Screenshots placeholder tiles**, resolution-notes textarea.
- **Colors/tokens used:** **Hardcoded-dark, ~25–30 classes.**
- **Data displayed:** **Live** (`adminApi.listDisputes()`), but `raisedBy='—'`, `evidence=0` stubbed → Raised-By always "—", Evidence always empty.
- **Interactive elements:** Resolve (functional). **Dead/local-only:** "Mark reviewing" mutates local state only (no API → won't persist).
- **Inconsistent:** No pagination (siblings paginate); dashed-placeholder evidence tiles unique here.

### Page: Smartphones (`/smartphones`)
- **Layout:** `PageHeader` → filter Card → 7-col table (no pagination). Detail modal (lg).
- **Components used:** shared set + custom `PhoneModal`.
- **Key visual elements:** Device table (online dot, connection badge, banks, last ping, Disconnect); modal w/ Activity Log.
- **Colors/tokens used:** **Hardcoded-dark, ~20 classes.**
- **Data displayed:** **100% mock/empty, NOT wired.** Header always "0 online of 0 devices."
- **Interactive elements:** Disconnect buttons mutate **local state only**. Effectively all dead against real data.
- **Inconsistent:** Stranded mock page (like Payments); modal references fields no live source provides.

### Page: Settlement (`/settlement`)
- **Layout:** `PageHeader` (trigger) → 4 StatCards → Card w/ Tabs + one of three tables. No pagination.
- **Components used:** `Card`, `Badge`, `Button`, `Tabs`, `PageHeader`, `StatCard`.
- **Key visual elements:** 4 summary StatCards; Per-Trader / Per-Merchant / History tables; "Trigger manual settlement" w/ last-run timestamp.
- **Colors/tokens used:** StatCards tokenized; tables **hardcoded-dark ~25 classes.**
- **Data displayed:** **100% mock/empty** → all cards `₹0`, all tables empty.
- **Interactive elements:** Tab switching. **"Trigger manual settlement" is fake** — `setTimeout(1200)` then sets a client-side timestamp; no API.
- **Inconsistent:** StatCard row + a wholly fake action button.

### Page: Settings (`/settings`)
- **Layout:** `PageHeader` (Save) → maintenance banner → "Rate & Revenue" Card → 2-col grid of `Section` cards (Fees, Orders/Rate, Telegram, Notifications/Mode, IP Whitelist).
- **Components used:** `Card`, `Badge`, `Button`, `Select`, `Toggle`, `Input`, `Section`, `PageHeader` + custom IP-chip list.
- **Key visual elements:** Rate/margin inputs, read-only platform-revenue (8-decimal), fee inputs, expiry + rate-source select, Telegram tokens, two toggle rows w/ ON/OFF badge, IP add-input + removable chips.
- **Colors/tokens used:** Primitives tokenized; file adds **~30 hardcoded classes** (labels + `bg-gray-950` inner panels).
- **Data displayed:** **Split.** "Rate & Revenue" is **real** (`getSettings`/`updateSettings`, revenue read-only). **Everything else is local-only `useState`** with hardcoded defaults (fees, expiry, telegram, IPs `['203.0.113.7','198.51.100.24']`).
- **Interactive elements:** "Save rates" real. **Dead/local-only:** top "Save changes" flashes fake "✓ Saved"; Fees/Commission/Expiry/Telegram/Email/Maintenance toggles + entire IP whitelist never sent to any API.
- **Inconsistent:** Two Save buttons with opposite semantics (one real, one fake) on the same screen, with no visual distinction between what persists and what doesn't.

---

# 2. Trader Panel (5174)

Router `frontend/trader/src/App.jsx`. Accent token = teal `#14b8c4`. Shell = `TraderLayout` inside `.tf-scope`. Nav labels drift from page titles (nav "Details"→page "Offers & Details"; both `/buy-usdt` and `/payouts` title themselves "Buy USDT"). Token discipline varies wildly: **BuyUsdt/Dashboard clean; Offers (103 hardcoded grays), Settings (39), Login (27) heavy.** Three competing greens: teal `#14b8c4`, emerald `#22c55e`, and Smartphones' `#00d4aa`.

### Page: Login (`/login`)
- **Layout:** Centered single card, outside `.tf-scope`. Credentials step + 2FA-code step.
- **Components used:** All hand-rolled, no `ui.jsx`.
- **Key visual elements:** `rounded-2xl bg-gray-900` card, email/password (Show/Hide), 6-digit 2FA input (`tracking-[0.4em]`), error banner, spinner submit.
- **Colors/tokens used:** **Hardcoded-dark, ~27 classes; emerald accent** (`bg-emerald-600`) not the panel teal. No CSS vars.
- **Data displayed:** Live auth (`useAuth`).
- **Interactive elements:** All functional (login, 2FA verify disabled until 6 chars, back).
- **Inconsistent:** Strongest outlier — permanently dark, emerald not teal, `rounded-2xl` vs `.tf-card` 18px, zero primitives.

### Page: Dashboard (`/dashboard`)
- **Layout:** `PageHeader` (Online toggle) → `.tf-grid` 4 StatCards → `.tf-two` (Commission / Statistic) → xl:3-col (Payment-Details-Conversion spans 2 + Values-by-Currency).
- **Components used:** `Card`, `StatCard`, `Badge`, `Toggle`, `SearchInput`, `PageHeader` + `CommissionSection`/`StatisticSection`. `.tf-enter` entrance.
- **Key visual elements:** 4 KPI cards (My Rate, Success Rate, FTD today, STD today); Online pill; per-UPI conversion buckets (Good/Paused/New) w/ progress bars; currency-value legend.
- **Colors/tokens used:** Token-driven; **only 1 hardcoded gray** (paused bar) — cleanest page. StatCard accents teal/violet/green/blue.
- **Data displayed:** **Live** (`traderApi.dashboard()` + `paymentDetails()`); mock supplies zeroed fallbacks only.
- **Interactive elements:** Online toggle + search — functional.
- **Inconsistent:** Reference style. Minor: rateColor bars use Tailwind semantic classes vs inline tokens.

**`components/DashboardSections.jsx`** (used by Dashboard): `CommissionSection` = **real** (`traderApi.commission`), big number toggles ₹↔USDT w/ count-up. `StatisticSection` = **DEMO/hardcoded `STATDATA`** (grouped Pay-in `#22c55e`/Payout `#ef4444` SVG bar chart, v/h orientation, tooltips) — comment says "real series wired later." Fully custom SVG, 0 Tailwind grays.

### Page: Trades / "Sell USDT" (`/trades`)
- **Layout:** `PageHeader` (Export CSV) → 5-col filter Card → 10-col table + Pagination (25/pg).
- **Components used:** shared set + custom `CopyId`, `Stamp` (two-line time/date), `DepositBadge`.
- **Key visual elements:** Table (Gateway ID, FTD/STD type, Amount INR/USDT, My Rate, Exchange rate, Bank, Client, Created, Closed, Status).
- **Colors/tokens used:** **Hardcoded grays ~20** + `text-emerald-400` for My Rate. Status via token-aware `Badge`.
- **Data displayed:** **Live** (`traderApi.orders()` + `dashboard()` for rates).
- **Interactive elements:** Filters, status Select, Export CSV (real), CopyId, Pagination — functional. (Minor: 10-col header but `colSpan={11}` on empty row.)
- **Inconsistent:** Hardcoded grays vs BuyUsdt tokens; `STATUS` map differs from BuyUsdt's; `text-emerald-400` My Rate vs BuyUsdt teal.

### Page: Offers / "Offers & Details" (`/offers`)
- **Layout:** `PageHeader` (Add) → `xl:grid-cols-2`: left Offers column (grouped by method + NGO cards), right Details column (grouped by bank, filter, unlinked banner, NGO rows w/ inline OTP). Two large modals (`AddAccountModal` tabbed APK-wizard/Web-Login; `EditModal`).
- **Components used:** shared set + **massive custom inline** (`Modal`, `Field`, `LimitsForm`, `ApkWizardBody` 3-step, `WebLoginForm`+OTP, `OffersColumn`, `DetailsColumn`).
- **Key visual elements:** Offer cards w/ bank-initial circles + bulk toggle + dots menu; detail rows w/ status toggle, robot online icon, connection icon, limit dot, edit; amber unlinked banner; NGO rows w/ status badge + inline 6-digit OTP + Retry/Delete; 3-step Add wizard; Edit modal w/ collapsible limit windows.
- **Colors/tokens used:** **The most heavily hardcoded page — 103 gray/slate usages** (`text-gray-500` ×29, `border-gray-800` ×13, …) + emerald/amber/rose semantic tints. **Emerald accent, not teal.** Only the tab underline uses tokens.
- **Data displayed:** **Live from two backends** — trader `paymentDetails()` + NGO accounts via `lib/ngoApi.js` (port 3000). Polls every 5s while any NGO account pending/paused.
- **Interactive elements:** Add (APK wizard → trader backend; Web Login → NGO backend w/ OTP verify/resend); per-detail toggle/link/edit/delete; bulk enable/disable; NGO toggle/edit/delete/retry/inline-OTP. **Semi-dead:** APK step-2 "Smartphone" select is hardcoded `<option>No devices</option>`.
- **Inconsistent:** Its `Modal` is **fully dark-committed** (`bg-gray-900 text-white`) unlike BuyUsdt's token modal; emerald not teal. With Login, the biggest token violator.

### Page: BuyUsdt / "Buy USDT" (`/buy-usdt`)
- **Layout:** `PageHeader` → 6 scrollable pill tabs w/ count badges → error banner → Card w/ tab-dependent columns. `ProcessModal` overlay.
- **Components used:** `Card`, `Badge`, `Button`, `PageHeader` + custom `Elapsed`/`Countdown` (**live 1s timers**), `Row`, `ProcessModal`.
- **Key visual elements:** Pill tabs (Awaiting Processing … Dispute) w/ counts; dynamic columns; Accept-for-Processing / Process buttons; `Countdown` turns red under 60s; ProcessModal w/ payout details, countdown, receipt input, 4 actions.
- **Colors/tokens used:** **Fully token-driven — 0 hardcoded grays.** Semantic hexes teal `#14b8c4`, `#22c55e`, `#ef4444`.
- **Data displayed:** **Live** (`traderApi.payoutRequests`, polls every 8s). No mock.
- **Interactive elements:** All functional. **Placeholder:** receipt field is a URL text input "Paste receipt URL (upload coming soon)" — no real file upload.
- **Inconsistent:** Cleanest page w/ Dashboard, but its `STATUS_BADGE`/`TABS` differ from Trades' and Payouts' maps — three taxonomies.

### Page: Payouts / "Buy USDT" (`/payouts`) — ORPHAN (no sidebar link)
- **Layout:** `PageHeader` (title "Buy USDT") → Card w/ `Tabs` + 6-col table + Pagination.
- **Components used:** shared set + custom `WaitingTimer`.
- **Key visual elements:** 6 tabs w/ counts; table (ID, Received, Waiting, Method, Amount, Action); mono countdown red under 120s; "Accept for processing".
- **Colors/tokens used:** **Hardcoded grays ~13.**
- **Data displayed:** **Live-ish** (`traderApi.payouts()`) but `waitingSeconds` hardcoded `0` (timer always 00:00) and `priority` hardcoded 'normal'.
- **Interactive elements:** Tabs, Pagination. **"Accept for processing" is DEAD (no `onClick`).**
- **Inconsistent:** **A superseded/legacy duplicate of BuyUsdt** — different tab component, different keys, hardcoded grays, non-functional primary action, no nav entry.

### Page: Notifications (`/notifications`)
- **Layout:** `PageHeader` (Refresh) → 6-col filter Card → 8-col table + Pagination (8/pg).
- **Components used:** shared set.
- **Key visual elements:** Filter grid; table (Notification ID, Time, Amount, Currency, Bank, Method, Txn ID, Description).
- **Colors/tokens used:** **Hardcoded grays ~16.**
- **Data displayed:** **Live** (`traderApi.notifications()`); `bank` always null (shows "—").
- **Interactive elements:** Filters, Pagination. **"Refresh" is cosmetic** — spins the icon 600ms, does **not refetch**. The bank filter never matches (bank always null).
- **Inconsistent:** Fake Refresh; page size 8 vs 25 elsewhere.

### Page: Smartphones (`/smartphones`)
- **Layout:** `PageHeader` (Refresh + Add dropdown) → filter Card → 5-col table. Two pairing popups (install → code).
- **Components used:** shared set + `socket.io-client` + custom `popupStyles` (all inline hardcoded).
- **Key visual elements:** Add dropdown (only "PaymentBot"); table (name w/ status dot, model, registration code badge, last seen, dots); pairing popups (Download APK link + license code + Copy + spinner).
- **Colors/tokens used:** Popups use a **separate hardcoded palette** w/ accent **`#00d4aa`** (found nowhere else) + `#111827/#1f2937/#e6edf3`. Table hardcoded grays ~15.
- **Data displayed:** **Live via NGO backend** (`getDevices`, `generateLicense`). **Hardcoded `NGO_ID = '6a4be2…9802'`** for the socket room.
- **Interactive elements:** Refresh (real), pairing flow (generate license, copy, socket listens for `device-registered`). **Dead:** "Download Android APK" is `href="#"`; per-row dots have no `onClick`. Uses native `alert()`.
- **Inconsistent:** Biggest color outlier after Login — bespoke `#00d4aa`, hardcoded hex popups.

### Page: Settings (`/settings`)
- **Layout:** `PageHeader` → `lg:grid-cols-2` Sections: Deposit Address, Preferences, Account, Two-Factor, Telegram.
- **Components used:** `Card`/`Section`, `Badge`, `Button`, `Select`, `PageHeader` + custom `TwoFactorSection`.
- **Key visual elements:** Deposit address row (mono + TRC20 badge + Copy); Language/Timezone selects; read-only email + Change-password; **2FA panel** (QR + secret + verify + backup codes); Telegram bots.
- **Colors/tokens used:** **Hardcoded grays ~39** + emerald accent (not teal).
- **Data displayed:** **Mixed.** 2FA fully **live**; email live. **Placeholder:** `depositAddress='TXk9…demoTRC20…8fQ2'` (literal demo string); Language/Timezone static.
- **Interactive elements:** 2FA enable/disable/copy-codes functional; Copy address functional (copies demo string). **Dead:** "Change password", Telegram "Connect"/"Open link" (no handlers); Language/Timezone selects local-only (not persisted).
- **Inconsistent:** Hardcoded-gray + emerald; several non-functional buttons; demo deposit address shipped as if real.

---

# 3. Merchant Panel (5175)

Router `frontend/merchant/src/App.jsx`. Accent token = purple `#8b5cf6`. Shell = `MerchantLayout` inside `.tf-scope`. Payouts + Dashboard are the theme-correct reference; most other pages hardcode dark + **indigo** (Login, Orders modal, Balance gradient) — a third accent identity.

### Page: Login (`/login`)
- **Layout:** Centered card, outside `.tf-scope`. Login + 2FA steps.
- **Components used:** Custom inline; no primitives.
- **Colors/tokens used:** **Hardcoded-dark; indigo accent** (`bg-indigo-600`) not purple `#8b5cf6`.
- **Data displayed:** Live auth (role `merchant`).
- **Interactive elements:** All functional.
- **Inconsistent:** Indigo vs purple; only page outside `.tf-scope`.

### Page: Dashboard (`/dashboard`)
- **Layout:** `PageHeader` → `.tf-grid` 6 StatCards → 3-col (Daily-Revenue chart spans 2 + Recent Transactions).
- **Components used:** `Card`, `StatCard`, `Badge`, `PageHeader` + custom `RevenueChart`.
- **Key visual elements:** 6 KPI cards (Today's Collections, Total Transactions, Success Rate, Pending Orders, USDT Balance, Pay-in Fee) w/ floating `.tf-badge` icons; violet bar chart w/ tooltip; recent-tx list.
- **Colors/tokens used:** Token-driven; chart hardcodes `from-violet-500/40 to-violet-500`; success `#22c55e`; trend `#22c55e`/`#ef4444`.
- **Data displayed:** **Mixed.** StatCards **live** (`merchantApi.dashboard()`). **Revenue chart + Recent Transactions are mock `[]`** → always empty states.
- **Interactive elements:** Chart tooltips; refetch on `order:update`.
- **Inconsistent:** Chart violet literals vs `--accent` purple; live cards but permanently-empty panels.

### Page: Orders (`/orders`)
- **Layout:** `PageHeader` (Create) → Card w/ Tabs + table + Pagination. `CreateOrderModal`.
- **Components used:** `Card`, `Badge`, `Button`, `Tabs`, `Pagination`, `PageHeader`, `Modal`, `Input` + custom `DepositBadge`.
- **Key visual elements:** 8 status tabs w/ counts; table (Gateway ID, Amount, Customer Ref, FTD/STD, Status, Copy-link); modal (create form: amount, customer ref, FTD/STD radios, merchant order id → success view w/ gateway id + checkout URL copy/open → "P2P unavailable" error view).
- **Colors/tokens used:** Page/tabs tokenized; **table + modal body hardcoded-dark ~20 classes** + indigo (`accent-indigo-500`, `bg-indigo-600` open-checkout).
- **Data displayed:** **Live** (`merchantApi.orders()` + `createOrder`); local fabricated order only on true network outage.
- **Interactive elements:** All functional (create, copy link, open checkout, tabs). No dead controls.
- **Inconsistent:** Table + modal permanently dark + indigo while shell/tabs are themed — **the most visually split merchant page.**

### Page: Payouts (`/payouts`)
- **Layout:** `PageHeader` → 3-col: New-request form (1) + My-requests list (2) w/ status filter.
- **Components used:** `Card`, `Badge`, `Button`, `Input`, `Select`, `PageHeader` + local token-styled `Field`.
- **Key visual elements:** Form (amount, method, recipient, conditional UPI or account/IFSC/bank, inline message); requests table (ID, Recipient, Method, Amount, Created, Status).
- **Colors/tokens used:** **Fully token-driven** — cleanest merchant page w/ Dashboard. Inline message rgba only.
- **Data displayed:** **Fully live** (`merchantApi.myPayouts` + `createPayout`, refresh on `order:update`).
- **Interactive elements:** Form (validated, method-conditional), filter, submit — all functional.
- **Inconsistent:** None significant.

### Page: Transactions (`/transactions`)
- **Layout:** `PageHeader` (Export CSV) → filter Card (search + From/To dates + Clear) → table + Pagination.
- **Components used:** `Card`, `Badge`, `Button`, `SearchInput`, `Pagination`, `PageHeader`.
- **Key visual elements:** Search, two native date pickers, table (Txn ID, Order ID, Amount, UTR, Sender, Method, Time).
- **Colors/tokens used:** **Hardcoded-dark ~14** + `[color-scheme:dark]` on date inputs (dark-locked) + indigo focus.
- **Data displayed:** **Live** (`merchantApi.transactions()`).
- **Interactive elements:** Search, date filter, Clear, Export CSV, Pagination — all functional.
- **Inconsistent:** Permanent-dark filter bar + table; explicitly `[color-scheme:dark]`.

### Page: Balance (`/balance`)
- **Layout:** `PageHeader` (Request withdrawal) → 3-card summary (gradient Available + settled + pending) → Settlement History table. Withdrawal modal.
- **Components used:** `Card`, `Badge`, `Button`, `PageHeader`, `Modal`, `Input`.
- **Key visual elements:** Gradient balance card, two stat cards, settlement table, withdrawal modal.
- **Colors/tokens used:** **Hardcoded-dark ~20**; gradient `from-indigo-600/20 to-gray-900` (indigo, not purple).
- **Data displayed:** **Partial + placeholder.** Available/pending **live** (`merchantApi.balance()`, fallback `pending_inr:84200`). "This month settled" mock `0`; **"▲9.2% vs last month", "Next settlement ~6h", `*89` FX are hardcoded placeholders.** Settlement History mock `[]`.
- **Interactive elements:** **Withdrawal is DEAD/FAKE** — `submit()` sets `requested=true`, `setTimeout` closes modal; no API (no withdrawal endpoint exists).
- **Inconsistent:** Permanent-dark; fake withdrawal; hardcoded fake trend/FX/timing; empty table.

### Page: API Credentials (`/api-credentials`)
- **Layout:** `PageHeader` → Section "Keys" (two `CredentialRow`s + warning) → code-example Card.
- **Components used:** `Card`, `Button`, `Section`, `PageHeader` + custom `CredentialRow`.
- **Key visual elements:** API key + secret rows (masked, Show/Hide, Copy, Regenerate), amber warning, static code sample.
- **Colors/tokens used:** Section themed; **code blocks hardcoded-dark ~10** (`bg-gray-950`).
- **Data displayed:** **Mostly mock.** API key live-ish (`merchantApi.apiCredentials()` else mock `pk_live_…`); **secret always mock `sk_live_…`** (GET never returns it); code sample references placeholder domains `api.p2p-gateway.com`.
- **Interactive elements:** Show/Hide + Copy functional. **Regenerate is DEAD/FAKE** — generates a random local string, no API, warning claims invalidation that never happens.
- **Inconsistent:** Permanent-dark code blocks; fake Regenerate; always-mock secret.

### Page: Webhooks (`/webhooks`)
- **Layout:** `PageHeader` → Section "Endpoint" (URL + Save + Test + events) → Delivery Logs table.
- **Components used:** `Card`, `Badge`, `Button`, `Input`, `Section`, `PageHeader`.
- **Key visual elements:** URL input, Save, Test (spinner), events string, delivery-logs table.
- **Colors/tokens used:** Section themed; **table hardcoded-dark ~8.**
- **Data displayed:** **Fully mock.** URL seeds `https://teststore.com/…`; logs `[]`.
- **Interactive elements:** **Save is DEAD** — transient "Saved" label, **never calls the real `merchantApi.setWebhook`** (which exists but is unused). **Test is FAKE** — prepends a fabricated 200 log via `setTimeout`.
- **Inconsistent:** Entirely mock/fake despite a real endpoint existing.

### Page: Profile (`/profile`)
- **Layout:** `PageHeader` (Save) → 2-col: Business Info Section + Security Section. Change-password modal.
- **Components used:** `Button`, `Input`, `Section`, `PageHeader`, `Modal`.
- **Key visual elements:** Name/email/phone inputs, security panel, change-password modal.
- **Colors/tokens used:** Sections themed; **labels/panels hardcoded-dark ~8.**
- **Data displayed:** **Mostly mock.** Name/email from `useAuth` (real) else mock; **phone always mock `+91 98765 43210`; "Last changed 42 days ago" hardcoded.**
- **Interactive elements:** **Save is DEAD** (transient "✓ Saved", no persist). **Change password is DEAD** (validates locally, closes, no API).
- **Inconsistent:** Fake save/password; hardcoded phone + "42 days ago"; permanent-dark sub-panels.

---

# 4. Checkout (5176) — customer/donor-facing

Single state machine `frontend/checkout/src/pages/CheckoutPage.jsx`, **light-only** (no `.tf-scope`, no theme toggle). `:root` accent = teal `#14b8c4`. Custom `co-*` classes only (no `ui.jsx`). All data **live** via `fetchCheckout(orderId)` — no mock fallback. Strings from `utils/i18n.js` but `lang` hardcoded `'en'` (Hindi exists, unreachable). `SUPPORT_WHATSAPP` = placeholder `wa.me/919000000000`. `STEP.FAILED` is effectively unreachable (backend `failed`→EXPIRED).

### Screen: LoadingScreen (initial)
- **Layout:** `Shell` centered spinner. **Components:** custom. **Visual:** 48px ring, `border-gray-200` base + `borderTopColor var(--accent)`. **Data:** none (during fetch). **Interactive:** none. **Inconsistent:** `border-gray-200` literal.

### Screen: PAYMENT (`STEP.PAYMENT`)
- **Layout:** `Shell` → `TopBar` (Exit/timer/Support) → heading + order-id/deposit-badge/amount → `co-inset` QR+UPI card → `co-inset` proof selector → Submit + Cancel → `co-inset` "How to pay".
- **Components used:** All custom `co-*` + `QRCode` (react-qr-code). No `ui.jsx`.
- **Key visual elements:** QR (168px, fg `#111827`), Download-QR, full UPI id `co-tile` + Copy, Payee/Bank tiles, 3 radio proof options (UTR / Upload screenshot / no-proof), conditional UTR input, conditional file picker, no-proof warning, Submit, Cancel, how-to-pay list.
- **Colors/tokens used:** Tokens + `co-*`, plus many **inline hexes**: timer `#dc2626` under 120s; FTD `#d1fae5`/`#047857`, STD `#dbeafe`/`#1d4ed8`; Copy `rgba(20,184,196,.1)`; selected option `rgba(20,184,196,.06)`; no-proof `#fef3c7`/`#92400e`; UTR error `#f87171`.
- **Data displayed:** **Live** — gateway/short id, deposit type, amount, UPI id, payee, bank, QR, countdown.
- **Interactive elements:** Copy UPI, Download QR, proof radios, UTR input (validated ≥12), Submit→`claimPaid`, Cancel→`cancelOrder`(confirm) — functional. **DEAD: "Upload screenshot"** renders an `<input type="file">` **bound to nothing** (no `onChange`/state/ref/endpoint); the file is never read or sent; `claimPaid` transmits only `confirmationType:'screenshot'` with no file. Helper text "will be reviewed by our team" is misleading.
- **Inconsistent:** Heavy inline hex vs token system; the file picker is the one truly non-functional control on the whole customer surface.

### Screen: PROCESSING (`STEP.PROCESSING`)
- **Layout:** `Shell` centered 64px spinner + "Verifying your payment…" + "do not close." **Colors:** `border-gray-200` + `var(--accent)`. **Data:** static; reached after claim or when status `claimed_paid`/`under_review`. **Interactive:** none (polling/socket advance). 

### Screen: SUCCESS (`STEP.SUCCESS`)
- **Layout:** `Shell` centered check + receipt (amount, txn ref, order id) + return.
- **Colors/tokens:** **hardcoded `bg-emerald-100`/`text-emerald-600`** icon; rest tokens + teal CTA.
- **Data:** **Live** — amount, txnRef, gateway id; if `redirectUrl` present, Return is a real merchant link, else reload.
- **Interactive:** Return (functional). No dead controls.
- **Inconsistent:** emerald literals vs token green.

### Screen: REJECTED (`STEP.REJECTED`)
- **Layout:** `Shell` red X + "Payment not verified" + reason + full-width Contact-support CTA.
- **Colors:** hardcoded `bg-red-100`/`text-red-600`.
- **Data:** **Live** `rejectionReason`. **Interactive:** WhatsApp support (placeholder number).
- **Inconsistent:** Support is a big teal CTA here vs a muted link on Disputed/Unavailable/End.

### Screen: DISPUTED (`STEP.DISPUTED`)
- **Layout:** `Shell` amber triangle + "Under review" + reason + muted support link.
- **Colors:** hardcoded `bg-amber-100`/`text-amber-600`. **Data:** **Live** `rejectionReason`. **Interactive:** support link.
- **Inconsistent:** Near-identical amber to UNAVAILABLE despite different meaning.

### Screen: EXPIRED / FAILED / ERROR (shared `EndScreen`)
- **Layout:** `Shell` red X + title/sub + Try-Again (reload) + muted support.
- **Colors:** hardcoded `bg-red-100`/`text-red-600`.
- **Data:** static; ERROR sub = `errorMsg`. **FAILED variant effectively unreachable.**
- **Inconsistent:** Three semantically different states (expired / failed / load-error) share one identical visual.

### Screen: UNAVAILABLE (`STEP.UNAVAILABLE`)
- **Layout:** `Shell` amber triangle + "Payment Unavailable" + Return-to-store + muted support. Also the catch-all fallback.
- **Colors:** hardcoded amber. **Data:** static; reached when `hasUpi === false`. **Interactive:** Return + support.
- **Inconsistent:** Visually indistinguishable from DISPUTED.

---

# 5. Android APK — "MaxPay" (`com.example.paymentbot`)

All live UI built **programmatically in Java** (no XML inflation). No Material Components — plain AppCompat + `GradientDrawable`. Two visual languages coexist: **current** white / blue `#1565C0` / green `#1B5E3B` (Splash, Permission, Registration, SetDeviceName, Main, Settings) vs **legacy** black / neon-green `#00FF88`/`#34D399` (Onboarding + overlays + dead `activity_main.xml`). Launch flow: `SplashActivity` (2s) → if unregistered `PermissionActivity` (3 pages) → `RegistrationActivity` → `SetDeviceNameActivity` → `MainActivity`; else straight to `MainActivity`. `OnboardingActivity` is manifest-declared but **unreachable/dead**.

### Screen: Splash (`SplashActivity`)
- **Layout:** Centered white column: green oval logo (120dp, white "₹" 48sp), "MaxPay" (32sp green), tagline (14sp grey), spinner.
- **Components:** `LinearLayout`/`FrameLayout`/`TextView`/`ProgressBar`, code-built.
- **Colors:** green `#1B5E3B`, grey `#666666`, white bg.
- **Data:** static branding. **Interactive:** none (2s auto-nav). **Notable:** does the registration check.

### Screen: Permission Wizard (`PermissionActivity`)
- **Layout:** White column, top-left ✕, centered icon+title+desc, full-width bottom button; 3 sequential pages via `setContentView` swap.
- **Pages:** 🔔 Notification access → "Allow"; ⚠️ Battery optimization → "Disable"; 💬 SMS → "Grant". Emoji icons (64sp).
- **Colors:** white bg, titles `#1A1A1A`, desc `#666666`, blue button `#1565C0`.
- **Data:** static. **Interactive:** ✕ close + per-page action; auto-advances in `onResume` after each system-settings trip.

### Screen: Device Registration (`RegistrationActivity`)
- **Layout:** White column: ← back, "Device registration", live Android-ID subtitle, centered code `EditText` w/ blue underline, status line, bottom "Continue".
- **Colors:** blue underline `#1565C0`; **Continue toggles grey `#9E9E9E` (disabled) → blue `#1565C0`** at ≥4 chars; error red `#E53935`.
- **Data:** **Live** — real Android ID; POSTs to `/api/apk/register-device`.
- **Interactive:** back, code input (uppercases, enables button), Continue (verifies → SetDeviceName).

### Screen: Set Device Name (`SetDeviceNameActivity`)
- **Layout:** Same pattern: ← back, "Set device name", `EditText` + blue underline + helper, bottom "Confirm"; success `AlertDialog`.
- **Colors:** identical white/blue palette; Confirm grey→blue when non-empty.
- **Data:** **Live** — POSTs to `/api/apk/update-device-name`. **Notable:** proceeds to save + non-cancelable "Registration complete" dialog **regardless of network result** → MainActivity on "Ok".

### Screen: Main / Home + Settings (`MainActivity`) — PRIMARY UI
- **Layout:** white root → **top bar** (📱 + device name + "Active" pill) → weighted page area (Home / Settings, one VISIBLE) → **bottom nav** (🏠 Home / ⚙️ Settings, 1dp top divider).
- **Top bar:** device name **live** (`getDeviceName`); **"Active" pill** = green `#1B5E3B` on `#E8F5EE`, **hard-coded static text — never reflects real service/connection status.**
- **Home:** centered **"Working"** label (static grey `#666666`) + full-width blue "Enable payment mode" button (→ overlay-permission check → starts `PaymentOverlayService`). A **hidden legacy live feed** (`buildFeed()`, `View.GONE`) is still kept updated in the background (captures still record/upload; simply not shown).
- **Settings:** ScrollView of label/value rows — Device name, Server URL, License key (masked `XX****`), App version "1.0.0", Android ID (all **live**) — + conditional blue "Enable screenshot capture" (MediaProjection consent) + green "Download logs" (share sheet).
- **Bottom nav:** active tab green `#1B5E3B`, inactive grey `#999999`.
- **onCreate side effects (drive the "Active" claim):** starts KeepAlive + watchdog + `PaymentOverlayService` + `OverlayService` + `HeartbeatService`.
- **Notable:** Both home "status" indicators ("Active" pill + "Working") are **static strings** with no binding to real health.

### Screen: Onboarding (`OnboardingActivity`) — DEAD / UNREACHABLE
- **Layout:** Black `ViewFlipper`, 4 slides (💳 Welcome, 📱 SMS, 🔔 Notifications, 🔋 Battery) w/ dots + "N of 4"; green rounded buttons.
- **Colors:** black `#000000`, green `#34D399`, white titles, grey `#A1A1AA` — **distinct legacy dark theme.**
- **Notable:** Manifest-declared but launched by nothing; still says "PaymentBot"; confirmed older design.

### Overlay: Payment Capture (`PaymentOverlayService`)
- **Three floating windows:** (1) **passive badge** top-left — "PaymentBot • <app>", `0xCC000000` bg, neon-green `#00FF88`, non-touchable; (2) **success card** bottom-center (650px) — "✅ Payment Captured!" + "₹amount → name / via app" + optional "UTR" (`#4488FF`) + "Add Purpose"/"✕", auto-dismiss 8s; (3) **purpose picker** (700px) — 7 purpose buttons (`#1A1A1A`/`#00FF88`) + Skip.
- **Data:** **Live** amount/recipient/UTR; purpose POSTs to `/api/apk/update-purpose`.
- **Notable:** Dark neon-green language, unlike the white home UI.

### Overlay: Screenshot / Input Recorder (`OverlayService`)
- **Draggable button panel** top-right (150dp): "⏺ RECORD" (`#333333`, → "🔴 Recording…" `#FF4444`) + "📷 SCREENSHOT" (`#0066CC`). **Recording status panel** (Account/IFSC/Name/Amount, account masked to last 4). Transient feedback toast.
- **Data:** **Live** captured fields (fed by accessibility engine); screenshot POSTs base64 JPEG + recorded fields to `/api/apk/screenshot`.

### Persistent notification (`KeepAliveService`)
- Ongoing foreground notification: **"💳 PaymentBot Active" / "Monitoring payments 24/7"**, `setOngoing(true)`. The one always-visible status in the shade.

### Dead/legacy assets
- **`res/layout/activity_main.xml`** — dead pre-redesign dark screen ("Payment Bot", "Status: NOT ACTIVE", neon `#00FF88`); never inflated.
- **`OnboardingActivity`** — unreachable. **`colors.xml`** palette mostly unreferenced (Java hard-codes hex). `Theme.PaymentBot` extends AppCompat.Light (no Material).

---

# Summary

## A. Full page/screen list per surface (total scope)

| Surface | Count | Pages / Screens |
|---|---|---|
| **Admin (5173)** | 11 | Login, Dashboard, Traders, Merchants, Orders, Payments, Payouts, Disputes, Smartphones, Settlement, Settings |
| **Trader (5174)** | 9 (+1 orphan) | Login, Dashboard, Trades, Offers, BuyUsdt, **Payouts (orphan/legacy)**, Notifications, Smartphones, Settings (+ `DashboardSections`) |
| **Merchant (5175)** | 9 | Login, Dashboard, Orders, Payouts, Transactions, Balance, ApiCredentials, Webhooks, Profile |
| **Checkout (5176)** | 9 screens | Loading, PAYMENT, PROCESSING, SUCCESS, REJECTED, DISPUTED, EXPIRED, FAILED (unreachable), UNAVAILABLE, ERROR |
| **APK (MaxPay)** | 6 screens + 2 overlays + notif | Splash, Permission, Registration, SetDeviceName, Main (Home+Settings), Onboarding (dead) · PaymentOverlay, OverlayService · KeepAlive notification |

**Total ≈ 44 distinct screens** across the product.

## B. Cross-surface inconsistencies

**1. Four+ competing "brand" accents.** Admin red `#ef4444` (Login uses `red-600`); Trader teal `#14b8c4` (but Login/Offers/Settings use **emerald**, Smartphones uses **`#00d4aa`**); Merchant purple `#8b5cf6` (but Login/Orders/Balance use **indigo**); Checkout teal `#14b8c4`; APK green `#1B5E3B` + blue `#1565C0` + legacy neon `#00FF88`. No single brand color survives across surfaces, and several panels contradict their *own* accent.

**2. Every Login page is off-system.** All four web logins render outside `.tf-scope`, are permanently dark, use a different accent than their panel (red-600 / emerald / indigo), and share zero primitives.

**3. Hardcoded-dark tables/modals everywhere.** The apps default to **light**, yet the majority of admin/merchant/trader list tables, modals, and form labels hardcode `gray-800/900/950` + `text-white`. Worst offenders: `trader/Offers.jsx` (103), `admin/Traders.jsx` (~80), `admin/Merchants.jsx` (~55), `admin/Orders.jsx` (~50), `trader/Settings.jsx` (39). These render dark chrome on white cards.

**4. Component duplication / drift.** Trader `ui.jsx` is a thinner, older copy (missing Modal/Field/Input/Section, no StatCard `trend`, Button has no `size`/`success`/`subtle`). `Badge color="rose"` renders 3 different colors across panels. Row-action menus use ✎-portal (Traders) vs `⋯`-absolute (Merchants). Three separate order-status→color maps in admin alone; three status taxonomies in the trader panel.

**5. Empty `mock.js` breaks "fallback" pages.** Because every seed array is `[]`, admin Payments/Smartphones/Settlement and merchant Revenue/RecentTx/Settlement/Webhooks show permanent empty states, and the admin Dashboard live-feed simulation actively throws (`% 0 = NaN`).

**6. Placeholder data shipped as real.** Trader deposit address (`TXk9…demo…8fQ2`), merchant phone (`+91 98765 43210`), "Last changed 42 days ago", "▲9.2% vs last month", "Next settlement ~6h", `*89` FX rate, `api.p2p-gateway.com` domains, `wa.me/919000000000` support, rickroll how-to URL.

**7. Duplicate/legacy screens.** Trader `/payouts` is an orphaned legacy duplicate of `/buy-usdt` (no nav link, dead "Accept" button, hardcoded timer). APK `activity_main.xml` + `OnboardingActivity` are dead. Checkout `STEP.FAILED` is unreachable.

**8. Radius/spacing ramp is unsystematic.** 9/11/12/14/16/18px radii used ad hoc; only checkout tokenizes `--radius`. Tailwind configs are all empty `extend:{}`, so nothing is centralized.

## C. Dead / fake controls (consolidated)

- **Admin:** Traders "Reset password"/"Add balance"; Merchants "Edit"/"Set commission" (×2) + local-only Deactivate/Regenerate; Disputes "Mark reviewing" (local); Settlement "Trigger" (fake `setTimeout`); Settings top "Save changes" + all non-rate controls (local); Payments/Smartphones entirely mock.
- **Trader:** `/payouts` "Accept for processing" (no handler); Notifications "Refresh" (spins only); Settings "Change password"/Telegram links + non-persisted Language/Timezone; Smartphones "Download APK" (`href="#"`) + row dots; BuyUsdt receipt "upload coming soon"; Offers APK-wizard device select (hardcoded "No devices"); "Downloads" nav (disabled).
- **Merchant:** Balance withdrawal (fake); ApiCredentials Regenerate (fake); Webhooks Save + Test (fake — real `setWebhook` endpoint exists but unused); Profile Save + Change-password (fake).
- **Checkout:** **"Upload screenshot" file picker (unbound, no upload backend)** — the only dead control on the customer surface.
- **APK:** "Active" pill + "Working" label (static, not health-bound); dead `activity_main.xml` + `OnboardingActivity`.

## D. Screens most in need of visual work — ranked

Ranked by (a) how customer-facing / business-critical and (b) how outdated or broken they currently look.

**Tier 1 — Customer-facing, directly affects revenue/trust:**
1. **Checkout · PAYMENT screen** — the donor-facing conversion surface. Broken "Upload screenshot" control (erodes trust mid-payment), placeholder support number, heavy inline-hex styling, semantically-identical result screens (Disputed vs Unavailable vs Expired/Error look alike). Highest ROI.
2. **Checkout · result screens (Success/Rejected/Disputed/Expired/Error)** — three different states share one red-X visual; amber Disputed == amber Unavailable. Clarity here affects support load and repeat-payment confidence.
3. **APK · Main/Home** — the trader's device app; "Active"/"Working" are static strings, two clashing visual languages, dead legacy assets. Trust-critical for onboarding traders.

**Tier 2 — Operator-facing, business-critical, currently rough:**
4. **Merchant · Orders (create-order modal)** — where merchants generate checkout links; the modal is permanently dark + indigo against a light purple panel — the most visually split page. First thing a new merchant touches.
5. **Merchant · Dashboard / Balance** — first-impression revenue view; live cards beside permanently-empty charts + fake trend/FX/withdrawal.
6. **Admin · Orders / Traders / Merchants** — the ops workhorses; all hardcoded-dark on a light theme, with several dead modal buttons.
7. **Trader · Offers** — the single worst token offender (103 hardcoded grays), fully-dark modal, emerald-not-teal; core to a trader configuring payment accounts.

**Tier 3 — Outdated/broken but lower traffic or clearly legacy:**
8. **All four web Login pages** — off-theme, off-accent, permanently dark; low traffic but a poor first impression.
9. **Trader · Settings, Smartphones** — hardcoded grays / bespoke `#00d4aa` popups / demo deposit address; dead buttons.
10. **Admin · Settings, Disputes, Payments, Smartphones, Settlement** — mix of hardcoded-dark and pure-mock/fake pages; Settings' two-Save-buttons (one real, one fake) is actively confusing.
11. **Merchant · ApiCredentials, Webhooks, Profile** — hardcoded-dark + fake save/regenerate/test flows.
12. **Trader · `/payouts` (orphan), APK `activity_main.xml` + `OnboardingActivity`, Checkout FAILED** — dead/legacy; candidates for removal rather than restyle.

---

*End of audit. No files other than this report were created or modified.*
