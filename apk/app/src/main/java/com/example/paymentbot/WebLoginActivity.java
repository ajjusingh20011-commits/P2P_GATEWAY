package com.example.paymentbot;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Phase 1 — On-device "Web Login" (WebView) capture.
 *
 * <p>The trader logs into the real platform dashboard inside this WebView; the
 * session cookie persists on-device (CookieManager, exactly like a normal
 * browser). A ~60s poll injects JavaScript that calls the platform's own
 * transaction API — for Paytm this mirrors the server-side Playwright scraper
 * ({@code webScraper.js}: dashboard.paytm.com {@code /api/v3/order/list} +
 * {@code /api/v4/order/detail} for the RRN). New rows are handed to the SAME
 * offline-first {@link EventQueue} pipeline SMS/notification captures use, so
 * they reach {@code POST /api/apk/event} and the real matching engine — tagged
 * {@code source=web_login_paytm} so the backend can tell them apart.
 *
 * <p>INSTRUMENTED: every step writes to the on-screen diagnostic panel so the
 * first real device run reports exactly what happened (page URL, whether the
 * API returned JSON or was blocked, rows found, rows delivered). Whether the
 * order-list API is reachable from inside a mobile WebView is the one thing
 * that can only be confirmed on a real device with a real logged-in session —
 * this screen is built to make that answer visible immediately.
 *
 * <p>Phase 1 polls while this screen is open (foreground). Moving the WebView
 * into KeepAliveService for true background polling is the productionization
 * step once the extraction approach is confirmed to work at all.
 */
public class WebLoginActivity extends AppCompatActivity {

    private static final String TAG = "PaymentBot";

    // Platforms. Only Paytm has extraction logic in Phase 1.
    private static final String P_PAYTM = "paytm";
    private static final String P_GPAY = "gpay";
    private static final String P_PHONEPE = "phonepe";

    private static final String PAYTM_URL = "https://dashboard.paytm.com/next/transactions";

    // Desktop UA so the platform serves its desktop dashboard — the same
    // context the server-side Playwright scraper runs in and where the
    // order-list API is known to work. A mobile UA may serve a different
    // experience or an "open in app" wall (reported live in the diagnostic).
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private static final long POLL_MS = 60_000L;
    private static final String PREFS = "weblogin";
    private static final String KEY_SEEN = "seen_order_ids";
    private static final int MAX_SEEN = 500;

    private WebView webView;
    private TextView diag;
    private TextView statusLine;
    private String platform = P_PAYTM;

    private final Handler poller = new Handler(Looper.getMainLooper());
    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            poll("timer");
            poller.postDelayed(this, POLL_MS);
        }
    };

    // ---------------------------------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF000000);
        root.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildHeader());

        // WebView takes the middle.
        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setUserAgentString(DESKTOP_UA);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);

        // Persistent cookies — this is what makes the login session survive
        // backgrounding/restart, same as a normal browser.
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Bridge(), "PBWeb");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // keep navigation inside the WebView
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                setStatus("Page: " + shortUrl(url));
                appendDiag("↺ loaded " + shortUrl(url));
            }
        });
        root.addView(webView);

        root.addView(buildDiagPanel());

        setContentView(root);

        loadPlatform(platform);
        appendDiag("Web Login ready. Log in above, then transactions poll every "
                + (POLL_MS / 1000) + "s. Use 'Check now' to poll immediately.");
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------
    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackgroundColor(0xFF111111);
        header.setPadding(dp(12), dp(10), dp(12), dp(10));

        TextView title = new TextView(this);
        title.setText("Web Login");
        title.setTextColor(0xFF34D399);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        header.addView(title);

        // Platform picker.
        LinearLayout picker = new LinearLayout(this);
        picker.setOrientation(LinearLayout.HORIZONTAL);
        picker.setPadding(0, dp(8), 0, dp(8));
        picker.addView(platformChip("Paytm", P_PAYTM));
        picker.addView(platformChip("GPay Business", P_GPAY));
        picker.addView(platformChip("PhonePe Business", P_PHONEPE));
        header.addView(picker);

        // Controls row.
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);

        Button check = new Button(this);
        check.setText("Check now");
        check.setAllCaps(false);
        check.setOnClickListener(v -> poll("manual"));
        controls.addView(check);

        Button reload = new Button(this);
        reload.setText("Reload login");
        reload.setAllCaps(false);
        reload.setOnClickListener(v -> loadPlatform(platform));
        controls.addView(reload);

        header.addView(controls);

        statusLine = new TextView(this);
        statusLine.setTextColor(0xFFA1A1AA);
        statusLine.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        statusLine.setText("Idle");
        header.addView(statusLine);

        return header;
    }

    private TextView platformChip(String label, final String key) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        chip.setPadding(dp(10), dp(6), dp(10), dp(6));
        boolean active = key.equals(platform);
        chip.setTextColor(active ? 0xFF000000 : 0xFFA1A1AA);
        chip.setBackgroundColor(active ? 0xFF34D399 : 0xFF27272A);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(6);
        chip.setLayoutParams(lp);
        chip.setOnClickListener(v -> selectPlatform(key));
        return chip;
    }

    private View buildDiagPanel() {
        ScrollView sc = new ScrollView(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(120));
        sc.setLayoutParams(lp);
        sc.setBackgroundColor(0xFF0A0A0A);

        diag = new TextView(this);
        diag.setTextColor(0xFF8AE0B8);
        diag.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        diag.setTypeface(Typeface.MONOSPACE);
        diag.setPadding(dp(10), dp(6), dp(10), dp(6));
        sc.addView(diag);
        return sc;
    }

    private void selectPlatform(String key) {
        if (!P_PAYTM.equals(key)) {
            Toast.makeText(this, "That platform arrives in Phase 2 — Paytm only for now",
                    Toast.LENGTH_SHORT).show();
            return;
        }
        platform = key;
        // Rebuild header chips + reload.
        recreate();
    }

    private void loadPlatform(String key) {
        if (P_PAYTM.equals(key)) {
            webView.loadUrl(PAYTM_URL);
        }
    }

    // ---------------------------------------------------------------------
    // Polling / injection
    // ---------------------------------------------------------------------
    private void poll(String trigger) {
        if (webView == null) return;
        if (!P_PAYTM.equals(platform)) return;
        setStatus("Polling (" + trigger + ")…");
        appendDiag("→ poll (" + trigger + ")");
        webView.evaluateJavascript(paytmExtractJs(), null);
    }

    /**
     * JS injected into the logged-in Paytm dashboard. Mirrors webScraper.js:
     * reads XSRF-TOKEN from cookies, POSTs /api/v3/order/list, then
     * /api/v4/order/detail per row for the RRN (UTR). Async, so results come
     * back via the PBWeb bridge, not evaluateJavascript's return value.
     */
    private String paytmExtractJs() {
        return "(async function(){"
                + "function diag(m){try{PBWeb.onDiag(String(m));}catch(e){}}"
                + "try{"
                + "  var xsrf='';var cs=document.cookie.split(';');"
                + "  for(var i=0;i<cs.length;i++){var t=cs[i].trim();"
                + "    if(t.indexOf('XSRF-TOKEN=')===0){xsrf=decodeURIComponent(t.split('=').slice(1).join('='));break;}}"
                + "  diag('xsrf='+(xsrf?'found':'MISSING')+' url='+location.href.slice(0,60));"
                + "  var now=new Date();var wk=new Date(Date.now()-7*24*3600*1000);"
                + "  function toIST(d){var i=new Date(d.getTime()+5.5*3600*1000);return i.toISOString().slice(0,19)+'+05:30';}"
                + "  var res=await fetch('https://dashboard.paytm.com/api/v3/order/list',{method:'POST',credentials:'include',"
                + "    headers:{'Content-Type':'application/json','Accept':'application/json','X-XSRF-TOKEN':xsrf,'X-Requested-With':'XMLHttpRequest'},"
                + "    body:JSON.stringify({bizTypeList:['ACQUIRING','CASHBACK','SPLIT_PAYMENT'],pageSize:20,pageNum:1,isSort:true,"
                + "      orderCreatedStartTime:toIST(wk),orderCreatedEndTime:toIST(now),orderStatusList:['SUCCESS','PENDING','FAILURE']})});"
                + "  var text=await res.text();"
                + "  diag('order/list HTTP '+res.status+' len='+text.length);"
                + "  var data={};try{data=JSON.parse(text);}catch(e){diag('list parse err: '+e.message);}"
                + "  var list=data.orderList||data.orders||data.data||data.list||[];"
                + "  diag('rows='+list.length);"
                + "  var out=[];var lim=Math.min(list.length,15);"
                + "  for(var j=0;j<lim;j++){var txn=list[j];"
                + "    var amtRaw=((txn.payMoneyAmount&&txn.payMoneyAmount.value)||txn.txnAmount||txn.amount||'0').toString();"
                + "    var amt=(parseFloat(amtRaw)/100).toFixed(2);"
                + "    var info=txn.additionalInfo||{};var bizId=txn.bizOrderId||'';"
                + "    var st=(txn.orderStatus==='SUCCESS'||txn.txnStatus==='TXN_SUCCESS')?'SUCCESS':'PENDING';"
                + "    var payer=info.customerName||txn.nickName||'Unknown';"
                + "    var upi=info.virtualPaymentAddr||txn.payerVpa||'';var rrn='';"
                + "    if(bizId){try{var dr=await fetch('https://dashboard.paytm.com/api/v4/order/detail',{method:'POST',credentials:'include',"
                + "      headers:{'Content-Type':'application/json','X-XSRF-TOKEN':xsrf,'X-Requested-With':'XMLHttpRequest'},"
                + "      body:JSON.stringify({bizOrderId:bizId,isSettlementInfo:true})});var dt=await dr.json();"
                + "      rrn=(dt&&dt.rrn)||(dt&&dt.order&&dt.order.rrn)||(dt&&dt.data&&dt.data.rrn)||(dt&&dt.txnInfo&&dt.txnInfo.rrn)||'';}catch(e){}}"
                + "    out.push({bizOrderId:bizId,amount:amt,payerName:payer,upiId:upi,status:st,utr:rrn});}"
                + "  PBWeb.onResult(JSON.stringify({ok:true,status:res.status,count:out.length,items:out}));"
                + "}catch(e){diag('FATAL '+e.message);try{PBWeb.onResult(JSON.stringify({ok:false,err:e.message}));}catch(x){}}"
                + "})();";
    }

    // ---------------------------------------------------------------------
    // JS bridge — runs on a WebView binder thread, not the UI thread.
    // ---------------------------------------------------------------------
    private final class Bridge {
        @JavascriptInterface
        public void onDiag(String msg) {
            runOnUiThread(() -> appendDiag("  · " + msg));
        }

        @JavascriptInterface
        public void onResult(String json) {
            try {
                JSONObject o = new JSONObject(json);
                if (!o.optBoolean("ok", false)) {
                    runOnUiThread(() -> {
                        setStatus("Poll failed");
                        appendDiag("✗ extract error: " + o.optString("err", "unknown"));
                    });
                    return;
                }
                JSONArray items = o.optJSONArray("items");
                int found = items == null ? 0 : items.length();
                int delivered = deliverNew(items);
                final int d = delivered;
                runOnUiThread(() -> {
                    setStatus("Found " + found + ", delivered " + d + " new");
                    appendDiag("✓ found " + found + ", queued " + d + " new → /api/apk/event");
                });
            } catch (Exception e) {
                runOnUiThread(() -> appendDiag("✗ onResult parse: " + e.getMessage()));
            }
        }
    }

    /**
     * Dedupes against the on-device seen-set and hands each genuinely new,
     * non-empty-amount row to the existing EventQueue pipeline. Returns the
     * number newly queued.
     */
    private int deliverNew(JSONArray items) {
        if (items == null || items.length() == 0) return 0;

        // Only forward once registered — same gate EventQueue itself enforces,
        // but checked here too so the diagnostic is honest about why nothing
        // was queued.
        if (!RegistrationManager.isRegistered(this)
                || TextUtils.isEmpty(RegistrationManager.getDeviceToken(this))) {
            runOnUiThread(() -> appendDiag("  (not registered — nothing queued)"));
            return 0;
        }

        Set<String> seen = loadSeen();
        int queued = 0;
        for (int i = 0; i < items.length(); i++) {
            JSONObject t = items.optJSONObject(i);
            if (t == null) continue;
            String bizId = t.optString("bizOrderId", "");
            String amount = t.optString("amount", "");
            String status = t.optString("status", "");
            // Only real, successful, identifiable, not-yet-seen rows.
            if (TextUtils.isEmpty(bizId) || seen.contains(bizId)) continue;
            if (!"SUCCESS".equals(status)) continue;
            if (TextUtils.isEmpty(amount) || "0.00".equals(amount)) continue;

            String payer = t.optString("payerName", "");
            String upi = t.optString("upiId", "");
            String utr = t.optString("utr", "");
            queueWebLoginTxn(amount, utr, payer, upi);
            seen.add(bizId);
            queued++;
        }
        if (queued > 0) saveSeen(seen);
        return queued;
    }

    /** Builds the /api/apk/event payload and hands it to the offline-first queue. */
    private void queueWebLoginTxn(String amount, String utr, String payerName, String upiId) {
        try {
            JSONObject json = new JSONObject();
            json.put("type", "WEB_LOGIN");
            json.put("source", "web_login_" + platform);
            json.put("category", "PAYMENT");
            json.put("sender", "Paytm Web Login");
            json.put("body", "₹" + amount
                    + (TextUtils.isEmpty(payerName) ? "" : " from " + payerName)
                    + (TextUtils.isEmpty(upiId) ? "" : " UPI " + upiId)
                    + (TextUtils.isEmpty(utr) ? "" : " UTR " + utr));
            json.put("amount", amount);
            json.put("utr", utr == null ? "" : utr);
            json.put("payerName", payerName == null ? "" : payerName);
            json.put("payerUpiId", upiId == null ? "" : upiId);
            json.put("utcTimestamp", TimeFormatter.toUTC(System.currentTimeMillis()));
            // Reuse the SAME offline-first pipeline as SMS/notification captures.
            EventQueue.enqueue(this, "/api/apk/event", json.toString(), true);
        } catch (Exception e) {
            runOnUiThread(() -> appendDiag("✗ queue build: " + e.getMessage()));
        }
    }

    // ---------------------------------------------------------------------
    // Seen-set (local dedupe) — bounded so it can't grow without limit.
    // ---------------------------------------------------------------------
    private Set<String> loadSeen() {
        Set<String> stored = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getStringSet(KEY_SEEN, null);
        return stored == null ? new HashSet<>() : new HashSet<>(stored);
    }

    private void saveSeen(Set<String> seen) {
        // Keep only the most recent MAX_SEEN — a HashSet has no order, so when
        // over the cap we just clear the overflow deterministically enough for
        // a dedupe cache (worst case a very old id could re-deliver once, which
        // the backend's (traderId, utr) dedupe still catches).
        if (seen.size() > MAX_SEEN) {
            Set<String> trimmed = new HashSet<>();
            int n = 0;
            for (String s : seen) {
                if (n++ >= MAX_SEEN) break;
                trimmed.add(s);
            }
            seen = trimmed;
        }
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putStringSet(KEY_SEEN, seen).apply();
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------
    @Override
    protected void onResume() {
        super.onResume();
        poller.postDelayed(pollRunnable, POLL_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        poller.removeCallbacks(pollRunnable);
        // Persist the session cookies to disk so they survive process death.
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        poller.removeCallbacks(pollRunnable);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    private void setStatus(String s) {
        if (statusLine != null) statusLine.setText(s);
    }

    private void appendDiag(String line) {
        if (diag == null) return;
        String prev = diag.getText().toString();
        // Keep the panel bounded — last ~40 lines.
        String[] lines = (prev + "\n" + line).split("\n");
        int start = Math.max(0, lines.length - 40);
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < lines.length; i++) sb.append(lines[i]).append('\n');
        diag.setText(sb.toString());
    }

    private static String shortUrl(String url) {
        if (url == null) return "";
        return url.length() > 60 ? url.substring(0, 60) + "…" : url;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
