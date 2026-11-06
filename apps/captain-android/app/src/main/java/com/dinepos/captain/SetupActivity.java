package com.dinepos.captain;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Where the main PC is: typed, or picked from the DinePOS servers that answered on this Wi-Fi (P2-15). The address is
 * checked with GET /v1/health before it is used. With a saved server that did not answer, it tries again every 10 s
 * and goes back to the captain app by itself when the server is there (at its old or a new address).
 *
 * <p>Result OK: with {@link #EXTRA_SERVER} the server to use now; without it, "the saved server answers again".
 */
public class SetupActivity extends Activity {
    public static final String EXTRA_SERVER = "server";
    public static final String EXTRA_SERVER_ID = "serverId";
    public static final String EXTRA_PROBLEM = "problem";
    private static final String EXTRA_FOUND_URLS = "foundUrls";
    private static final String EXTRA_FOUND_IDS = "foundIds";
    private static final String EXTRA_FOUND_NAMES = "foundNames";
    private static final String EXTRA_FOUND_HOSTS = "foundHosts";

    private static final long RETRY_MS = 10_000;
    private static final int MAX_FOUND = 8;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private EditText address;
    private Button connect;
    private TextView problem;
    private TextView foundTitle;
    private LinearLayout foundList;
    private String savedServer;
    private String savedId;
    private boolean busy;

    static void putFound(Intent i, List<FoundServer> found) {
        int n = Math.min(MAX_FOUND, found.size());
        String[] urls = new String[n], ids = new String[n], names = new String[n], hosts = new String[n];
        for (int k = 0; k < n; k++) {
            FoundServer f = found.get(k);
            urls[k] = f.url;
            ids[k] = f.serverId;
            names[k] = f.name;
            hosts[k] = f.host;
        }
        i.putExtra(EXTRA_FOUND_URLS, urls).putExtra(EXTRA_FOUND_IDS, ids).putExtra(EXTRA_FOUND_NAMES, names).putExtra(EXTRA_FOUND_HOSTS, hosts);
    }

    private static List<FoundServer> getFound(Intent i) {
        String[] urls = i.getStringArrayExtra(EXTRA_FOUND_URLS);
        String[] ids = i.getStringArrayExtra(EXTRA_FOUND_IDS);
        String[] names = i.getStringArrayExtra(EXTRA_FOUND_NAMES);
        String[] hosts = i.getStringArrayExtra(EXTRA_FOUND_HOSTS);
        if (urls == null || ids == null || names == null || hosts == null) return null;
        List<FoundServer> out = new ArrayList<>();
        for (int k = 0; k < urls.length && k < ids.length && k < names.length && k < hosts.length; k++) {
            out.add(new FoundServer(urls[k], ids[k], names[k], hosts[k]));
        }
        return out;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        savedServer = in.getStringExtra(EXTRA_SERVER);
        savedId = in.getStringExtra(EXTRA_SERVER_ID);
        buildViews();
        if (savedServer != null) address.setText(savedServer.replaceFirst("^http://", ""));
        String why = in.getStringExtra(EXTRA_PROBLEM);
        if (why != null) showProblem(savedServer != null ? why + "\n" + getString(R.string.setup_retrying) : why);
        List<FoundServer> found = getFound(in);
        if (found != null) showFound(found);
        else search();
        if (why != null && savedServer != null) ui.postDelayed(retry, RETRY_MS);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        bg.shutdownNow();
        super.onDestroy();
    }

    private void buildViews() {
        int pad = dp(20);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, pad);

        TextView title = text(getString(R.string.setup_title), 24, R.color.ink);
        col.addView(title);
        TextView hint = text(getString(R.string.setup_hint), 16, R.color.muted);
        hint.setPadding(0, dp(8), 0, dp(16));
        col.addView(hint);

        problem = text("", 16, R.color.problem);
        problem.setPadding(0, 0, 0, dp(12));
        problem.setVisibility(TextView.GONE);
        col.addView(problem);

        address = new EditText(this);
        address.setHint(R.string.setup_address);
        address.setTextSize(20);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setMinHeight(dp(56));
        // no autofill: an address remembered by the phone (another network, an old main PC) must not appear by itself
        address.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        address.setOnEditorActionListener((v, actionId, e) -> {
            if (actionId != EditorInfo.IME_ACTION_GO) return false;
            connect(address.getText().toString());
            return true;
        });
        col.addView(address, matchWidth());

        connect = button(getString(R.string.setup_connect));
        connect.setOnClickListener(v -> connect(address.getText().toString()));
        col.addView(connect, matchWidth());

        foundTitle = text(getString(R.string.setup_searching), 16, R.color.muted);
        foundTitle.setPadding(0, dp(28), 0, dp(8));
        col.addView(foundTitle);
        foundList = new LinearLayout(this);
        foundList.setOrientation(LinearLayout.VERTICAL);
        col.addView(foundList, matchWidth());

        Button again = button(getString(R.string.setup_search_again));
        again.setOnClickListener(v -> search());
        col.addView(again, matchWidth());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(getColor(R.color.paper));
        scroll.addView(col);
        if (Build.VERSION.SDK_INT >= 35) {
            scroll.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(scroll);
    }

    /** Checks the address, then hands it to the captain screen. */
    private void connect(String typed) {
        if (busy) return;
        String server = ServerAddress.normalize(typed);
        if (server == null) {
            showProblem("That is not a server address. Type it like 192.168.1.4 (shown on the billing PC in Settings › Devices).");
            return;
        }
        busy = true;
        connect.setEnabled(false);
        connect.setText(R.string.setup_checking);
        bg.execute(() -> {
            Health.Result r = Health.check(server);
            ui.post(() -> {
                if (isDestroyed()) return;
                busy = false;
                connect.setEnabled(true);
                connect.setText(R.string.setup_connect);
                if (!r.ok) {
                    showProblem(r.problem);
                    return;
                }
                ui.removeCallbacks(retry);
                Intent data = new Intent().putExtra(EXTRA_SERVER, server);
                if (r.serverId != null) data.putExtra(EXTRA_SERVER_ID, r.serverId);
                setResult(RESULT_OK, data);
                finish();
            });
        });
    }

    private void search() {
        foundTitle.setText(R.string.setup_searching);
        bg.execute(() -> {
            List<FoundServer> found = Discovery.discover(this, 1500);
            ui.post(() -> {
                if (!isDestroyed()) showFound(found);
            });
        });
    }

    private void showFound(List<FoundServer> found) {
        foundList.removeAllViews();
        foundTitle.setText(found.isEmpty() ? R.string.setup_none_found : R.string.setup_found);
        for (int k = 0; k < found.size() && k < MAX_FOUND; k++) {
            FoundServer f = found.get(k);
            Button b = button(f.label());
            b.setAllCaps(false);
            b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            b.setOnClickListener(v -> connect(f.url));
            foundList.addView(b, matchWidth());
        }
    }

    /** The saved server answers again, at its address or (same outlet) a new one: back to the captain app. */
    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            if (busy) {
                ui.postDelayed(this, RETRY_MS);
                return;
            }
            bg.execute(() -> {
                Health.Result r = Health.check(savedServer);
                boolean back = r.ok && (savedId == null || r.serverId == null || savedId.equals(r.serverId));
                List<FoundServer> found = back ? null : Discovery.discover(SetupActivity.this, 1500);
                boolean moved = found != null && FoundServer.pick(found, savedId, savedServer) != null;
                ui.post(() -> {
                    if (isDestroyed() || busy) return;
                    if (back || moved) {
                        setResult(RESULT_OK, new Intent());
                        finish();
                        return;
                    }
                    if (found != null) showFound(found);
                    ui.postDelayed(this, RETRY_MS);
                });
            });
        }
    };

    private void showProblem(String why) {
        problem.setText(why);
        problem.setVisibility(TextView.VISIBLE);
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(getColor(color));
        return t;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(18);
        b.setMinHeight(dp(56));
        return b;
    }

    private LinearLayout.LayoutParams matchWidth() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(8);
        return p;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
