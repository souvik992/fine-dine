package com.dinepos.captain;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * DinePOS Captain for Android: the captain app (served by the outlet server at /captain) full screen on the phone.
 * Nothing of the captain app is copied here: the window opens the server's page, so it is always the server's version,
 * and its service worker keeps it working offline as in Chrome.
 *
 * <p>Asks for the server once and remembers it. P2-15: when the main PC gets a new IP address, finds the same server
 * on the Wi-Fi and moves the phone's pairing and its unsent offline orders to the new address. The window may show only
 * that server's pages; other links are refused and every permission request (camera, microphone, location) is denied.
 * It never opens the database.
 */
public class MainActivity extends Activity {
    /** The launcher shortcut "Change the main PC" (res/xml/shortcuts.xml). */
    public static final String ACTION_SETUP = "com.dinepos.captain.SETUP";

    private static final int REQUEST_SETUP = 1;
    private static final long WATCH_MS = 15_000;
    private static final int DISCOVER_MS = 1500;
    private static final long SCRIPT_WAIT_MS = 5000;

    /** What the window is loading for the app (rather than for the captain): see onPageFinished. */
    private enum Step { NONE, EXPORT_LOAD, EXPORTING, SEED_AT_NEW }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private ConfigStore store;
    private CaptainConfig config;
    private WebView web;
    private TextView status;

    private Step step = Step.NONE;
    /** Where a move is going (set while the outbox is read at the old address). */
    private String moveUrl;
    private String moveId;
    /** Why the server did not answer, shown when the page cannot open from the phone's copy either. */
    private String lastProblem;
    /** Bumped whenever the app starts somewhere new, so late answers for an older attempt are dropped. */
    private int generation;
    private int misses;
    private boolean watching;
    private boolean resumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new ConfigStore(this);
        config = store.load();
        buildViews();
        if (ACTION_SETUP.equals(getIntent().getAction())) openSetup(null, null);
        else openCaptain();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ACTION_SETUP.equals(intent.getAction())) capture(() -> openSetup(null, null));
    }

    // ---------------------------------------------------------------- views

    @SuppressLint("SetJavaScriptEnabled")
    private void buildViews() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.paper));
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // the pairing and the sign-in live in the page's localStorage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false); // target=_blank stays in this window, and is checked like any link
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(false); // the order-ready chime plays with nobody touching the phone
        s.setUserAgentString(s.getUserAgentString() + " DinePOSCaptainAndroid/" + versionName());
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        status = new TextView(this);
        status.setTextColor(getColor(R.color.muted));
        status.setTextSize(18);
        status.setGravity(Gravity.CENTER);
        status.setPadding(48, 48, 48, 48);
        status.setBackgroundColor(getColor(R.color.paper));
        root.addView(status, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        status.setVisibility(View.GONE);

        // Android 15+ draws apps under the status and navigation bars: keep the page clear of them and of the keyboard
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    /** Back steps back inside the captain app; at its first page the app goes to the background (not closed). */
    private void back() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    private void showStatus(String text) {
        status.setText(text);
        status.setVisibility(View.VISIBLE);
    }

    private void hideStatus() {
        status.setVisibility(View.GONE);
    }

    // ---------------------------------------------------------------- where to go

    /** Opens the captain app at the saved server, at its new address, or the setup screen saying why it cannot. */
    private void openCaptain() {
        if (config.serverUrl == null) {
            openSetup(null, null);
            return;
        }
        final int gen = ++generation;
        final String saved = config.serverUrl;
        showStatus(getString(R.string.connecting, saved.replaceFirst("^https?://", "")));
        bg.execute(() -> {
            Health.Result r = Health.check(saved);
            if (r.ok && config.isOurs(r.serverId)) {
                post(gen, () -> go(saved, r.serverId));
                return;
            }
            // not there (or another outlet has that address now): the main PC may have a new address
            List<FoundServer> found = Discovery.discover(this, DISCOVER_MS);
            String[] moved = findMoved(found);
            if (moved != null) post(gen, () -> go(moved[0], moved[1]));
            else if (r.ok) post(gen, () -> openSetup(saved.replaceFirst("^https?://", "") + " is a different DinePOS outlet now. Choose this restaurant's main PC.", found));
            else post(gen, () -> {
                // the phone's copy of the captain app (service worker) still opens, offline; if not, setup says why
                lastProblem = r.problem;
                web.loadUrl(ServerAddress.captainUrl(saved));
            });
        });
    }

    /** P2-15: the saved server at a new address (from what answered on the Wi-Fi), as {url, serverId}, or null. */
    private String[] findMoved(List<FoundServer> found) {
        CaptainConfig c = config;
        String url = FoundServer.pick(found, c.serverId, c.serverUrl);
        if (url == null || url.equals(c.serverUrl)) return null;
        Health.Result r = Health.check(url);
        return r.ok && c.isOurs(r.serverId) ? new String[] {url, r.serverId} : null;
    }

    /**
     * The captain app at `url`. The same outlet at a new address first reads its unsent orders at the old address (a
     * page there, from the phone's copy when the old address is gone), then carries them over in {@link #arrive}.
     */
    private void go(String url, String serverId) {
        ++generation;
        boolean moving = config.serverUrl != null && !ServerAddress.mayOpen(url, config.serverUrl) && config.isOurs(serverId);
        if (!moving || store.movingOutbox() != null) {
            arrive(url, serverId);
            return;
        }
        moveUrl = url;
        moveId = serverId;
        if (showingCaptain()) exportOutbox();
        else {
            step = Step.EXPORT_LOAD;
            web.loadUrl(ServerAddress.captainUrl(config.serverUrl));
        }
    }

    private void exportOutbox() {
        step = Step.EXPORTING;
        final int gen = generation;
        web.evaluateJavascript(PageScripts.exportOutbox(), null);
        poll(PageScripts.EXPORT_VAR, gen, exported -> {
            String checked = PageScripts.checkExport(exported);
            if (checked != null && PageScripts.count(checked) > 0) store.setMovingOutbox(checked);
            step = Step.NONE;
            arrive(moveUrl, moveId);
        });
    }

    /**
     * Saves where the server is and opens the captain app there. When this phone has a pairing or unsent orders for
     * that server, they go into the address's storage first (on its health page, then the captain app), so a new
     * address does not ask to be paired again and no order is left behind.
     */
    private void arrive(String url, String serverId) {
        ++generation;
        boolean sameOutlet = config.isOurs(serverId);
        CaptainConfig next = config.forServer(url, serverId);
        if (!sameOutlet) store.setMovingOutbox(null); // never give one outlet's orders to another
        if (!next.equals(config)) store.save(next);
        config = next;
        misses = 0;
        moveUrl = null;
        moveId = null;
        if (config.deviceToken != null || store.movingOutbox() != null) {
            step = Step.SEED_AT_NEW;
            web.loadUrl(ServerAddress.healthUrl(url));
        } else {
            step = Step.NONE;
            web.loadUrl(ServerAddress.captainUrl(url));
        }
    }

    /** On the new address's health page: pairing, then outbox, then the captain app. */
    private void seed() {
        final int gen = generation;
        final String url = config.serverUrl;
        web.evaluateJavascript(PageScripts.seedDevice(config.deviceToken), null);
        final String moving = store.movingOutbox();
        if (moving == null) {
            step = Step.NONE;
            web.loadUrl(ServerAddress.captainUrl(url));
            return;
        }
        web.evaluateJavascript(PageScripts.importOutbox(moving), null);
        poll(PageScripts.IMPORT_VAR, gen, result -> {
            if (PageScripts.IMPORTED.equals(result)) {
                store.setMovingOutbox(null);
                int n = PageScripts.count(moving);
                Toast.makeText(this, n == 1 ? "1 order change taken offline moved to the main PC's new address."
                    : n + " order changes taken offline moved to the main PC's new address.", Toast.LENGTH_LONG).show();
            }
            step = Step.NONE;
            web.loadUrl(ServerAddress.captainUrl(url));
        });
    }

    /** Waits for an asynchronous page script's answer (null after SCRIPT_WAIT_MS or when the app moved on). */
    private void poll(String var, int gen, Consumer<String> done) {
        final long deadline = System.currentTimeMillis() + SCRIPT_WAIT_MS;
        new Runnable() {
            @Override
            public void run() {
                if (gen != generation) return;
                web.evaluateJavascript(PageScripts.read(var), raw -> {
                    if (gen != generation) return;
                    String v = PageScripts.decodeString(raw);
                    if (v != null || System.currentTimeMillis() > deadline) done.accept(v);
                    else ui.postDelayed(this, 150);
                });
            }
        }.run();
    }

    private void post(int gen, Runnable r) {
        ui.post(() -> {
            if (gen == generation && !isDestroyed()) r.run();
        });
    }

    /** Whether the window shows the saved server's captain app now (not a page the app loaded for itself). */
    private boolean showingCaptain() {
        return step == Step.NONE && config.serverUrl != null && ServerAddress.isCaptainPage(web.getUrl(), config.serverUrl);
    }

    // ---------------------------------------------------------------- keeping up with the page and the server

    /** Keeps a copy of the page's pairing (it changes inside the page, e.g. when the phone is paired). */
    private void capture(Runnable then) {
        if (!showingCaptain()) {
            if (then != null) then.run();
            return;
        }
        final String at = config.serverUrl;
        web.evaluateJavascript(PageScripts.captureDevice(), raw -> {
            if (showingCaptain() && at.equals(config.serverUrl)) {
                String token = CaptainConfig.token(PageScripts.decodeString(raw), 512);
                if (token != null ? !token.equals(config.deviceToken) : config.deviceToken != null) {
                    config = config.withDeviceToken(token);
                    store.save(config);
                }
            }
            if (then != null) then.run();
        });
    }

    /**
     * Every 15 s while the app is in front: copy the pairing; when the server has not answered twice in a row, look
     * for it on the Wi-Fi and follow it if it now has another address. (A server that is only restarting comes back at
     * the same address, and the captain app reconnects by itself.)
     */
    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            ui.removeCallbacks(this);
            if (!resumed) return;
            ui.postDelayed(this, WATCH_MS);
            if (watching || !showingCaptain()) return;
            watching = true;
            final int gen = generation;
            final String at = config.serverUrl;
            capture(() -> bg.execute(() -> {
                Health.Result r = Health.check(at);
                boolean ours = r.ok && config.isOurs(r.serverId);
                String[] moved = null;
                int m = ours ? 0 : misses + 1;
                if (m >= 2) moved = findMoved(Discovery.discover(MainActivity.this, DISCOVER_MS));
                final String[] to = moved;
                ui.post(() -> {
                    watching = false;
                    if (gen != generation) return;
                    misses = m;
                    if (to != null && showingCaptain()) go(to[0], to[1]);
                });
            }));
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        web.onResume();
        ui.postDelayed(watch, WATCH_MS);
    }

    @Override
    protected void onPause() {
        resumed = false;
        ui.removeCallbacks(watch);
        capture(null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        bg.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // ---------------------------------------------------------------- setup screen

    private void openSetup(String problem, List<FoundServer> found) {
        Intent i = new Intent(this, SetupActivity.class);
        if (config.serverUrl != null) i.putExtra(SetupActivity.EXTRA_SERVER, config.serverUrl);
        if (config.serverId != null) i.putExtra(SetupActivity.EXTRA_SERVER_ID, config.serverId);
        if (problem != null) i.putExtra(SetupActivity.EXTRA_PROBLEM, problem);
        if (found != null) SetupActivity.putFound(i, found);
        startActivityForResult(i, REQUEST_SETUP);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_SETUP) return;
        if (resultCode != RESULT_OK) {
            if (!showingCaptain()) finish(); // nothing to go back to: leave the app
            return;
        }
        String server = data == null ? null : data.getStringExtra(SetupActivity.EXTRA_SERVER);
        if (server == null) openCaptain(); // "it answers again": start over at the saved server
        else {
            showStatus(getString(R.string.connecting, server.replaceFirst("^https?://", "")));
            go(server, data.getStringExtra(SetupActivity.EXTRA_SERVER_ID));
        }
    }

    // ---------------------------------------------------------------- the window

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // only the server's own pages; anything else (another site, tel:, intent:, file:) is refused
            return !ServerAddress.mayOpen(request.getUrl().toString(), config.serverUrl);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (step == Step.EXPORT_LOAD && ServerAddress.isCaptainPage(url, config.serverUrl)) {
                exportOutbox();
            } else if (step == Step.SEED_AT_NEW && ServerAddress.mayOpen(url, config.serverUrl) && Uri.parse(url).getPath() != null
                && Uri.parse(url).getPath().startsWith("/v1/health")) {
                seed();
            } else if (step == Step.NONE && ServerAddress.isCaptainPage(url, config.serverUrl)) {
                hideStatus();
                lastProblem = null;
                capture(null);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            if (step == Step.EXPORT_LOAD) {
                step = Step.NONE; // the old address has no copy of the page: nothing to carry over
                arrive(moveUrl, moveId);
            } else if (step == Step.SEED_AT_NEW) {
                step = Step.NONE; // the captain app then asks to be paired, as before P2-15
                web.loadUrl(ServerAddress.captainUrl(config.serverUrl));
            } else if (ServerAddress.mayOpen(request.getUrl().toString(), config.serverUrl)) {
                String why = lastProblem != null ? lastProblem : "Lost the DinePOS server (" + error.getDescription() + ").";
                web.loadUrl("about:blank");
                openSetup(why, null);
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // the page's process was stopped (low memory): start a fresh window rather than leave the app broken
            recreate();
            return true;
        }
    }

    private static final class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny(); // no camera, microphone…
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            return false;
        }
    }
}
