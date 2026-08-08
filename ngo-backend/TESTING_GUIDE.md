# Notifications Page Redesign — Testing Guide

## Test Data Status

✅ **5 comprehensive demo transactions created in MongoDB:**

| # | Type | Amount | Payer | Status | Capture Type |
|---|------|--------|-------|--------|--------------|
| 1 | APK Notification | ₹500 | Priya Sharma | ✓ Linked | Notification |
| 2 | APK Notification | ₹1,200 | Amit Patel | ⏳ Process | Notification |
| 3 | APK SMS | ₹300 | ICICI Bank | ✓ Linked | SMS |
| 4 | APK SMS | ₹75,000 | Axis Bank | ⏳ Process | SMS |
| 5 | Web Scraper | ₹20 | Varun Singh | ✓ Linked | Web Scraper |

---

## Setup & Launch

### 1. Start ngo-backend (MongoDB required)

```bash
cd ngo-backend
npm install  # if not already done
npm start
```

**Expected output**:
```
✓ Server running on port 3000
✓ MongoDB connected to mongodb://localhost:27017/ngodb
```

### 2. Start trader frontend dev server

```bash
cd frontend/trader
npm install  # if not already done
npm run dev
```

**Expected output**:
```
  VITE v4.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

### 3. Navigate to Notifications page

Open browser: **http://localhost:5173**

Login with trader credentials (if required), then navigate to **Notifications** in the sidebar.

---

## Visual Verification Checklist

### Table Layout (1440px width)

- [ ] **6 columns visible** (left to right):
  1. Info icon (compact, ~40px)
  2. Time (90px: "HH:MM AM" + "DD.MM.YYYY")
  3. Amount (80px, right-aligned, bold)
  4. Method (150px: badge + device name)
  5. Description (flexible width, shows original text + subtitle)
  6. Status (100px: badge + info icon)

- [ ] **Table header** is styled differently (gray background, uppercase labels, smaller font)
- [ ] **Rows are alternating** (no striping, but have border-bottom separators)
- [ ] **Last row** does not extend beyond card bounds
- [ ] **Pagination** shows at the bottom (should say "1 of 1" with 5 rows per page)

---

## Data Accuracy Checks

### Row 1: APK Notification (Linked) — ₹500

**Column breakdown**:
- **Info icon**: Click → shows ID `520420048991AB1` (UTR)
- **Time**: Shows timestamp (today, ~6:00 AM)
- **Amount**: `₹500` (bold)
- **Method**: Colored badge showing "GPay" + muted line "Demo Device (Test)"
- **Description**: Full text: "Payment received from Priya Sharma for ₹500. UPI Ref: 520420048991AB1. Balance: ₹18,500. -Google Pay" + subtitle "Notification · Demo Device (Test)"
- **Status**: Green "Linked" badge + info icon (click → shows `520420048991AB1`)

✅ **Expected**: Linked status with green badge

### Row 2: APK Notification (Process) — ₹1,200

**Column breakdown**:
- **Info icon**: Click → shows ID `UPI1204958761AB`
- **Time**: Shows timestamp (today, ~3:15 PM)
- **Amount**: `₹1,200`
- **Method**: Colored badge "Paytm" + muted line "Demo Device (Test)"
- **Description**: "You received ₹1,200 from Amit Patel via Paytm. Reference: UPI1204958761AB. Check now: paytm.com" + subtitle "Notification · Demo Device (Test)"
- **Status**: Amber "Process" badge (no info icon)

✅ **Expected**: Process status with amber badge, no info icon

### Row 3: APK SMS (Linked) — ₹300

**Column breakdown**:
- **Info icon**: Click → shows ID `RRN654321987`
- **Time**: Shows timestamp (today, ~1:45 PM)
- **Amount**: `₹300`
- **Method**: Badge + "Demo Device (Test)"
- **Description**: "A/c **0456 debited for INR 300. Avl Bal: INR 42,750. Ref No. RRN654321987. -ICICI Bank" + subtitle "SMS · Demo Device (Test)"
- **Status**: Green "Linked" badge + info icon

✅ **Expected**: SMS capture type visible, Linked status

### Row 4: APK SMS (Process) — ₹75,000

**Column breakdown**:
- **Info icon**: Click → shows ID `UPI7654321098`
- **Time**: Shows timestamp (today, ~2:32 PM)
- **Amount**: `₹75,000` (large amount, formatted with commas)
- **Method**: Badge + "Demo Device (Test)"
- **Description**: "Your A/C ending with 7890 has been debited with INR 75,000.00 on 08-08-2024 at 14:32. Avl balance: INR 1,25,000. Ref:UPI7654321098. -Axis Bank" + subtitle "SMS · Demo Device (Test)"
- **Status**: Amber "Process" badge

✅ **Expected**: Large amount formatted correctly, SMS type, Process status

### Row 5: Web Scraper (Linked) — ₹20

**Column breakdown**:
- **Info icon**: Click → shows ID `RRN9123456789`
- **Time**: Shows timestamp (today, ~5:00 AM)
- **Amount**: `₹20` (small amount)
- **Method**: Badge "Paytm" + muted line **"web"** (NOT a device name)
- **Description**: "Payment from Scraped: Varun Singh (varun.singh@paytm)" + subtitle "Web scraper · web"
- **Status**: Green "Linked" badge + info icon (click → `RRN9123456789`)

✅ **Expected**: Source shows "web" (not device name), capture type shows "Web scraper"

---

## Interactive Tests

### Filters

- [ ] **Filter by Notification ID**: Type any part of a transaction ID (e.g., "2024") → rows filter down
- [ ] **Filter by Amount**: Type "500" → shows rows with ₹500 and ₹75,000 (substring match)
- [ ] **Filter by Method**: Select "GPay" → shows only row 1; select "Paytm" → shows rows 2, 4, 5
- [ ] **Clear filter**: Remove text or reset → all 5 rows reappear

### Info Icons

- [ ] **Notification ID icon**: Click → tooltip appears showing full ID above icon
- [ ] **Status info icon** (Linked rows only): Click → tooltip shows transaction ID
- [ ] **Click elsewhere**: Tooltips disappear
- [ ] **Hover vs click**: Buttons show `title` attribute (tooltip on hover) for accessibility

### Pagination

- [ ] Currently shows "1–5 of 5" (all rows fit on one page)
- [ ] Pagination controls appear at bottom but should be inactive (only 1 page)
- [ ] If more rows were added, pagination would become active

### Refresh Button

- [ ] Click "Refresh" in top-right → spinner appears on button
- [ ] After data loads → spinner stops
- [ ] Table remains unchanged (same 5 rows, same order)

---

## Console Validation

### Browser DevTools (Press F12)

**Console tab**:
- [ ] **Zero errors** (red messages)
- [ ] **Zero unhandled promise rejections** 
- [ ] Allowed warnings: deprecations, vendor prefixes
- [ ] Check for: `"Cannot read property 'type' of undefined"` or `"devices is not defined"` — these indicate data-loading issues

**Network tab**:
- [ ] `GET /trader/ngo-proxy/ngo/transactions` → HTTP 200 ✓
  - Response should show transaction array with `rawEventId` field populated
  - For APK rows: `rawEventId: { type: "SMS"|"NOTIFICATION", body: "...", deviceId: "..." }`
  - For web row: `rawEventId: null`
- [ ] `GET /trader/ngo-proxy/apk/devices` → HTTP 200 ✓
  - Should include "Demo Device (Test)" in the devices array

---

## Expected Visual Appearance

### Table Column Proportions (1440px)

```
┌──────┬──────────┬────────┬────────────┬────────────────┬────────────┐
│ Info │   Time   │ Amount │   Method   │  Description   │   Status   │
│ 40px │   90px   │ 80px   │   150px    │   (flexible)   │   100px    │
└──────┴──────────┴────────┴────────────┴────────────────┴────────────┘
```

### Responsive Behavior

- **At 1440px**: All columns visible, description column takes remaining space
- **At 1200px**: Should still display correctly (check if text truncates appropriately)
- **At <1000px**: Layout may wrap or scroll horizontally (acceptable for MVP)

---

## Common Issues & Fixes

### Issue: Empty table (no rows showing)

**Possible causes**:
- MongoDB not running → Check `ngo-backend` logs
- API not returning data → Check Network tab in DevTools
- React state not updating → Check browser console for errors

**Fix**:
1. Verify MongoDB is running: `mongodb://localhost:27017/ngodb`
2. Check `/api/transactions` response in Network tab
3. Clear browser cache (Ctrl+Shift+Delete) and reload

### Issue: rawEventId showing as "[object Object]"

**Possible causes**:
- Frontend not correctly mapping rawEventId data
- API returning unpopulated rawEventId (still an ObjectId string)

**Fix**:
1. Check Network tab: does response show `rawEventId: { type: "...", body: "..." }`?
2. If not, backend populate() may not be working
3. Check ngo.js line 296 to ensure `.populate()` call is in place

### Issue: Device names showing as IDs instead of "Demo Device (Test)"

**Possible causes**:
- Device lookup failing
- deviceMap not built correctly in frontend

**Fix**:
1. Check Network tab: does `GET /devices` response include "Demo Device (Test)"?
2. In browser DevTools Console: `fetch('/trader/ngo-proxy/apk/devices').then(r => r.json()).then(d => console.log(d))`
3. Verify device name is rendering in the component

---

## Cleanup After Testing

### Remove Test Data

**Option 1 (precise)**: Delete specific test transactions

```bash
# In MongoDB shell or Compass:
db.transactions.deleteMany({ 
  txnId: { $in: ['ORD-2024-001', 'TXN-20240808-002', 'ICICI-SMS-001', 'AXIS-LARGE-001', 'WEB-SCRAPE-001'] }
})

# Also delete the test device and associated RawEvents:
db.devices.deleteOne({ deviceName: "Demo Device (Test)" })
db.rawevents.deleteMany({ deviceId: /test-device-/ })
```

**Option 2 (bulk)**: Delete all transactions for trader 1 (if no other data)

```bash
db.transactions.deleteMany({ traderId: 1 })
db.devices.deleteMany({ traderId: 1 })
db.rawevents.deleteMany({ traderId: 1 })
```

---

## Success Criteria ✅

| Criterion | Pass? |
|-----------|-------|
| All 5 rows visible in table | ☐ |
| Table layout matches 6-column design | ☐ |
| Data accuracy correct for each row | ☐ |
| Info icons reveal IDs on click | ☐ |
| Linked vs Process status badges correct | ☐ |
| Capture type displays (SMS/Notification/Web scraper) | ☐ |
| Device name displays for APK, "web" for scraper | ☐ |
| Original text shown in Description column | ☐ |
| Filters work correctly (by ID, amount, method) | ☐ |
| Browser console shows ZERO errors | ☐ |
| Network requests all return HTTP 200 | ☐ |

**Test complete when all criteria checked ✓**

---

## Screenshots to Capture (for documentation)

1. **Full page at 1440px**: All 5 rows visible
2. **Zoomed row detail**: Description column showing full text (not truncated)
3. **Info icon hover**: Tooltip showing ID
4. **Linked status**: Green badge with info icon
5. **Process status**: Amber badge without info icon
6. **Browser console**: Tab showing zero errors
7. **Network tab**: Transaction response with populated rawEventId

---

## Questions?

If anything doesn't match expected behavior:
1. Check browser console for errors
2. Check Network tab for API response shape
3. Verify MongoDB data: run `verify-test-data-simple.js` again
4. Re-read this guide for the specific row/column
5. Check git diff in `ngo-backend/src/routes/ngo.js` to confirm populate() is present
