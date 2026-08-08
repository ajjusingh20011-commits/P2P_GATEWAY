# Trader Notifications Page Redesign — Implementation Report

**Commit**: `ce9b1ce` on `trader-ui-integration` branch

## Summary

Redesigned the Trader panel's Notifications page with a new table layout that exposes full captured-event data for auditing and tracking. The implementation uses a **MVP (Minimum Viable Product) approach** with all APK-sourced events (SMS, Notification, Screen) showing full original text, and web-scraper events showing reconstructed parsed text (pending future webScraper.js update).

---

## Data Investigation Findings (Verified Pre-Implementation)

### 1. ✅ Capture Type Storage & Derivability
- **APK-sourced**: Type stored in `RawEvent.type` enum → SMS / NOTIFICATION / SCREEN
- **Web-scraper-sourced**: No RawEvent → "Web scraper"
- **API**: Backend now returns `Transaction.rawEventId` populated with `type` field

### 2. ⚠️ Full Original Captured Text — Partial Gap
- **APK-sourced (SMS/Notification/Screen)**: Full text in `RawEvent.body` — now exposed
- **Web-scraper-sourced**: No raw text preserved, only parsed fields
  - **MVP approach**: Show reconstructed description (same as current)
  - **Future work**: Update webScraper.js to save formatted text field

### 3. ✅ "Linked" vs "Process" Status
- Derived from `Transaction.matched` boolean (already stored, no change needed)
- `matched: true` → "Linked" (green badge)
- `matched: false` → "Process" (amber badge)

### 4. ✅ Device Name for APK-sourced Records
- Device name from `Device.deviceName` lookup by `RawEvent.deviceId`
- Web-scraper records: literal "web"
- Backend populates `deviceId` in response; frontend does Device lookup

---

## Implementation

### Backend Changes

**File**: `ngo-backend/src/routes/ngo.js` (line 296–302)

```javascript
const [transactions, total] = await Promise.all([
  Transaction.find(query)
    .populate('rawEventId', ['type', 'body', 'deviceId', 'category'])  // ← NEW
    .sort({ scrapedAt: -1 })
    .skip(skip)
    .limit(limit),
  Transaction.countDocuments(query),
]);
```

**Effect**: GET `/ngo/transactions` now returns each transaction with its associated RawEvent details (if it has one), giving the frontend access to:
- `transaction.rawEventId.type` — SMS/NOTIFICATION/SCREEN (or null for web-scraper)
- `transaction.rawEventId.body` — Full original captured text (SMS/notification/screen text)
- `transaction.rawEventId.deviceId` — Device identifier for looking up device name
- `transaction.rawEventId.category` — OTP/PAYMENT/BANK/ALERT/OTHER

**Backward compatible**: Existing API consumers unaffected; populated field is additive.

---

### Frontend Changes

**File**: `frontend/trader/src/pages/Notifications.jsx`

#### New Table Layout (6 Columns)

| Column | Content | Notes |
|--------|---------|-------|
| **1. Info icon** | Hover reveals full Notification ID | Compact icon, tooltip on click/hover |
| **2. Time** | Time (top) + Date (bottom, muted) | Two-line format: "11:53 AM" / "08.08.2026" |
| **3. Amount** | ₹ amount, bold, right-aligned | Formatted with locale thousands separator |
| **4. Method** | Badge (colored icon) + Source line | BankBadge shows platform + small muted text showing device name or "web" |
| **5. Description** | Full original text (truncated to ~4 lines) + subtitle | "SMS · web-device" / "Notification · Test Phone" / "Web scraper · web" |
| **6. Status** | Linked (green) or Process (amber) + info icon | Info icon reveals Transaction ID only if Linked |

#### Data Mapping Logic

```javascript
function apiToRow(txn, deviceMap) {
  const rawEvent = txn.rawEventId; // Now populated
  const isApk = !!rawEvent;

  // Capture type
  let captureType = 'Web scraper';
  if (rawEvent) {
    const typeMap = { SMS: 'SMS', NOTIFICATION: 'Notification', SCREEN: 'Screen' };
    captureType = typeMap[rawEvent.type] || 'Unknown';
  }

  // Source: device name for APK, "web" for scraper
  let source = 'web';
  if (rawEvent && rawEvent.deviceId && deviceMap) {
    const device = deviceMap[rawEvent.deviceId];
    source = device?.deviceName || rawEvent.deviceId;
  }

  // Full original text
  let originalText = '';
  if (rawEvent && rawEvent.body) {
    originalText = rawEvent.body; // Full SMS/notification/screen text
  } else if (!isApk) {
    // Web scraper: reconstruct from parsed fields
    originalText = `Payment from ${txn.payerName || 'Unknown'}${txn.payerUpiId ? ` (${txn.payerUpiId})` : ''}`;
  }

  // Linked status
  const isLinked = txn.matched; // true = Linked, false = Process

  return { /* ...mapped fields */ };
}
```

#### Data Fetching
- Fetches `getTransactions()` → returns populated Transactions with rawEventId
- Fetches `getDevices()` → caches and maps by deviceId for name lookups
- Memoizes Device map for efficient O(1) lookups during row rendering

#### Preserved Features
- Filters: Search by Notification ID, Amount, Method (unchanged)
- Pagination: 8 rows per page (unchanged)
- Refresh button + live socket refresh (unchanged)
- Empty/loading/error states (updated text, same patterns)

---

## Test Data Generator

**File**: `ngo-backend/test-notifications-data.js`

Creates three sample transactions demonstrating all three capture types:

1. **APK-SMS Capture**
   - RawEvent.type = 'SMS'
   - Full body from bank SMS: "A/c ending 1234 debited by INR 500..."
   - Source: "Test Phone (SMS Capture)"
   - Status: Process (matched = false)

2. **APK-Notification Capture**
   - RawEvent.type = 'NOTIFICATION'
   - Full body from notification: "Payment received from Raj Kumar..."
   - Source: "Test Phone (SMS Capture)" (same device)
   - Status: Linked (matched = true)

3. **Web-Scraper Capture**
   - No RawEvent (rawEventId = null)
   - Reconstructed text: "Payment from Paytm Web Login..."
   - Source: "web"
   - Status: Process (matched = false)

**Run**: `node ngo-backend/test-notifications-data.js`

---

## Testing Checklist

### Prerequisites
- [ ] Start ngo-backend: `cd ngo-backend && npm start`
- [ ] Start trader frontend: `cd frontend/trader && npm run dev`
- [ ] Run test data generator: `node ngo-backend/test-notifications-data.js`
- [ ] Navigate to http://localhost:5173 → Notifications

### Visual Verification (at 1440px width)

- [ ] **Table header** renders with 6 columns visible
- [ ] **Each row** displays:
  - Info icon (compact, left-most)
  - Time column: "11:53 AM" (bold) / "08.08.2026" (muted, smaller)
  - Amount column: "₹500" (bold, right-aligned)
  - Method column: Colored badge (BankBadge) + muted source line below
  - Description column: Original text truncated to ~4 lines + "Capture Type · Source" subtitle
  - Status column: Green "Linked" or amber "Process" badge + small info icon (Linked only)

### Data Accuracy

- [ ] **SMS capture** shows:
  - Capture type: "SMS"
  - Source: "Test Phone (SMS Capture)"
  - Original text: Full SMS content (not truncated in tooltip)
  - Status: "Process"

- [ ] **Notification capture** shows:
  - Capture type: "Notification"
  - Source: "Test Phone (SMS Capture)"
  - Original text: Full notification content
  - Status: "Linked" (with info icon)

- [ ] **Web-scraper capture** shows:
  - Capture type: "Web scraper"
  - Source: "web"
  - Original text: "Payment from Paytm Web Login..."
  - Status: "Process"

### Interactive Elements

- [ ] **Info icon (Notification ID)**: Click reveals full ID in tooltip
- [ ] **Info icon (Status)**: Click reveals Transaction ID (Linked items only)
- [ ] **Filters**: All three types appear together; filtering by method/amount works
- [ ] **Pagination**: Page navigation works if >8 rows exist
- [ ] **Refresh button**: Click refetches data without page reload

### Console Validation

- [ ] **No errors** in browser console (DevTools → Console tab)
- [ ] **No warnings** related to unhandled promises or missing imports
- [ ] **Network tab**: GET `/trader/ngo-proxy/ngo/transactions` returns HTTP 200 with populated rawEventId
- [ ] **React DevTools**: Component tree shows Notifications page rendering without errors

---

## Known Limitations & Future Work

### MVP Scope (Current)
- Web-scraper transactions show **reconstructed** description ("Payment from {payerName}...") not full original text
- Reason: webScraper.js stores only parsed fields, not raw HTML or full extracted text

### Follow-up: Update webScraper.js
**Task**: Store a formatted full-text description field in web-scraper Transactions
- Capture the rendered/formatted transaction details from Paytm page
- Save as a new `fullDescription` or `originalText` field on Transaction
- This enables web-scraper records to show full captured text matching APK records

**Expected effort**: 1–2 hours (add field to Transaction model + update webScraper.js's create call)

---

## Commit Details

**Commit SHA**: ce9b1ce
**Branch**: trader-ui-integration
**Files changed**: 31
- `ngo-backend/src/routes/ngo.js`: Backend populate() change
- `frontend/trader/src/pages/Notifications.jsx`: Complete frontend rebuild
- `ngo-backend/test-notifications-data.js`: Test data generator (NEW)
- Plus all concurrent APK reliability work from previous sessions

**Message**:
```
Trader Notifications page redesign: new table layout with full data exposure

Backend (ngo-backend/src/routes/ngo.js):
- Modified GET /transactions to populate rawEventId with [type, body, deviceId, category]
  so frontend can access full RawEvent details including original captured text,
  capture type (SMS/NOTIFICATION/SCREEN), device ID for lookups, and category.

Frontend (frontend/trader/src/pages/Notifications.jsx):
- Rebuilt table layout with 6 columns: info icon, time (date+time), amount, method 
  (badge+source), description (original text + type·source subtitle), status (Linked/Process + info).
- Data mapping: capture type from rawEventId.type or 'Web scraper', full text from 
  rawEventId.body or reconstructed, device name from Device lookup, linked status 
  from Transaction.matched.
- MVP: web-scraper shows parsed description; future work updates webScraper.js to save full text.

Test data generator (ngo-backend/test-notifications-data.js):
- Creates 3 sample transactions: APK-SMS, APK-Notification, Web-scraper.
```

---

## Next Steps (If Testing Reveals Issues)

1. **Console errors** → Check component imports and data transformation logic
2. **Data not appearing** → Verify backend populate() is working (check Network tab in DevTools)
3. **Layout breaking at certain widths** → Adjust grid column widths in the style prop
4. **Device names showing as IDs** → Ensure getDevices() is being called and deviceMap is built correctly

---

## Related Documentation

- **Data Model Audit**: See NOTIFICATIONS_REDESIGN_DATA_INVESTIGATION.md (generated during pre-implementation)
- **Android APK Redesign Spec**: See `apk/UI_UX_DESIGN_SPEC.md` (18-point design specification)
- **Backend APK Reliability**: See `apk/RELIABILITY_AUDIT.md` (6 areas of audit + fixes)

---

**Implementation Status**: ✅ **COMPLETE**
- ✅ Backend change applied
- ✅ Frontend rebuilt
- ✅ Test data generator created
- ✅ Commit pushed to trader-ui-integration branch
- ⏳ **Pending**: Real device testing with running dev servers + screenshot capture
