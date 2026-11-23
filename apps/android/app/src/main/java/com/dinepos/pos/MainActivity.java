package com.dinepos.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * DinePOS on this device: the billing screens (/pos) of the DinePOS server running here (DinePosServer), in a
 * locked-down window. The same screens as the Windows app; they fit a phone, a tablet or a POS machine.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILES = 1;
    private static final int PICK_BACKUP_FOLDER = 2;
    private static final String HOME = "http://127.0.0.1:" + DinePosServer.PORT + "/pos/";

    private BackupCopier backups;
    private WebView web;
    private LinearLayout status;
    private TextView statusText;
    private Button retry;
    private ValueCallback<Uri[]> pendingFiles;
    private UsbPrinters usb;
    private boolean pageReady;
    /** A USB printer change from before the screens loaded (DinePOS opened by plugging the printer in). */
    private String pendingUsb;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // a counter screen
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        backups = new BackupCopier(this);
        askPermissions();
        try {
            Intent svc = new Intent(this, PosService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
        } catch (Exception ignored) { /* DinePOS still runs while the window is open */ }
        backups.startTimer();

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false); // the online-order chime
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        web.setVisibility(View.INVISIBLE);
        web.addJavascriptInterface(new Bridge(), "DinePosAndroid"); // only DinePOS's own pages load in this window
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (isOwn(r.getUrl())) return false;
                // help links (https) open in the browser; nothing else leaves DinePOS
                if ("https".equals(r.getUrl().getScheme())) { try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) { } }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (!isOwn(Uri.parse(url))) return;
                v.setVisibility(View.VISIBLE);
                status.setVisibility(View.GONE);
                pageReady = true;
                if (pendingUsb != null) { String e = pendingUsb; pendingUsb = null; v.postDelayed(() -> tellPage(e), 1500); } // after sign-in state loads
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { pageReady = false; }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) { recreate(); return true; }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                Intent i = p.createIntent();
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(i, PICK_FILES); } catch (Exception e) { pendingFiles = null; return false; }
                return true;
            }
        });
        // downloads (CSV reports, the menu template): the page hands the file to saveFile below
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!url.startsWith("blob:") && !isOwn(Uri.parse(url))) return;
            String name = android.webkit.URLUtil.guessFileName(url, disposition, mime);
            String js = "fetch(" + quote(url) + ").then(r=>r.blob()).then(b=>new Promise(ok=>{const f=new FileReader();f.onload=()=>ok(f.result);f.readAsDataURL(b)}))"
                    + ".then(d=>DinePosAndroid.saveFile(" + quote(name) + "," + quote(mime == null ? "" : mime) + ",String(d).split(',')[1]))";
            web.evaluateJavascript(js, null);
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        status = new LinearLayout(this);
        status.setOrientation(LinearLayout.VERTICAL);
        status.setGravity(Gravity.CENTER);
        status.setPadding(48, 48, 48, 48);
        status.setBackgroundColor(Color.parseColor("#FAF7F2"));
        statusText = new TextView(this);
        statusText.setTextSize(18);
        statusText.setTextColor(Color.parseColor("#1F1B16"));
        statusText.setGravity(Gravity.CENTER);
        retry = new Button(this);
        retry.setText("Try again");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> start());
        status.addView(statusText);
        status.addView(retry);
        root.addView(status, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        // Android 15+ draws apps edge to edge: keep DinePOS clear of the status bar, the navigation bar and the keyboard
        // (before Android 11 the system keeps apps clear of the bars itself)
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v, insets) -> {
            int types = android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime();
            android.graphics.Insets i = insets.getInsets(types);
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return insets;
        });
        root.setBackgroundColor(Color.parseColor("#F5F2ED"));
        setContentView(root);
        usb = new UsbPrinters(this, e -> runOnUiThread(() -> tellPage(e.toString())));
        start();
        usb.handle(getIntent()); // opened by plugging in a USB printer
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (usb != null) usb.handle(intent); // a USB printer plugged in while DinePOS is open
    }

    /** A USB printer change, to the screens ("dinepos-usb-printer"); a short message when they are not showing yet. */
    private void tellPage(String json) {
        if (!pageReady) {
            pendingUsb = json;
            return;
        }
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('dinepos-usb-printer',{detail:" + json + "}))", null);
    }

    private static String quote(String s) { return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"; }

    private void start() {
        retry.setVisibility(View.GONE);
        status.setVisibility(View.VISIBLE);
        statusText.setText("Starting DinePOS…\nThe first start sets up the database and takes a little longer.");
        DinePosServer.start(this, new DinePosServer.Listener() {
            @Override public void ready() { runOnUiThread(() -> web.loadUrl(HOME)); }
            @Override public void failed(String message) { runOnUiThread(() -> { statusText.setText(message); retry.setVisibility(View.VISIBLE); }); }
        });
    }

    private static boolean isOwn(Uri u) {
        return u != null && "http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost()) && u.getPort() == DinePosServer.PORT;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_BACKUP_FOLDER) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                backups.setFolder(data.getData());
                new Thread(() -> { int n = backups.copyNow(); runOnUiThread(() -> toast(n < 0 ? "The backups could not be copied to that folder." : "Backups copied to the chosen folder.")); }).start();
            }
            return;
        }
        if (requestCode != PICK_FILES || pendingFiles == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) result = new Uri[]{data.getData()};
        }
        pendingFiles.onReceiveValue(result);
        pendingFiles = null;
    }

    private void askPermissions() {
        List<String> want = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) want.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) want.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!want.isEmpty()) requestPermissions(want.toArray(new String[0]), 3);
    }

    private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_LONG).show(); }

    /** What DinePOS's screens can ask of the Android app (window.DinePosAndroid). Only DinePOS's own pages load here. */
    private final class Bridge {
        /** Saves a download (CSV report, template) to the device's Downloads folder. Returns where, or "error". */
        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._ -]", "_");
            if (safe.isEmpty() || safe.length() > 120) safe = "dinepos-file";
            byte[] bytes = Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT);
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("no Downloads folder");
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { if (out == null) throw new Exception("cannot write"); out.write(bytes); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) throw new Exception("no storage");
                    try (OutputStream out = new FileOutputStream(new File(dir, safe))) { out.write(bytes); }
                }
                String where = "Saved to Downloads: " + safe;
                runOnUiThread(() -> toast(where));
                return where;
            } catch (Exception e) {
                runOnUiThread(() -> toast("The file could not be saved."));
                return "error";
            }
        }

        /** Print / PDF of the current page (reports) through Android's printing, which includes Save as PDF. */
        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                String job = title == null || title.isEmpty() ? "DinePOS" : title;
                pm.print(job, web.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
            });
        }

        /** Backups to a USB stick or SD card: choose the folder (Android's folder picker). */
        @JavascriptInterface
        public void chooseBackupFolder() {
            runOnUiThread(() -> {
                try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PICK_BACKUP_FOLDER); } catch (Exception e) { toast("This device cannot choose a folder."); }
            });
        }

        @JavascriptInterface
        public String backupStatus() { return backups.status(); }

        @JavascriptInterface
        public int copyBackupsNow() { return backups.copyNow(); }

        @JavascriptInterface
        public void forgetBackupFolder() { backups.clearFolder(); }

        /** Settings › Printers › Allow: asks Android again to let DinePOS use the USB printer "vid:pid". */
        @JavascriptInterface
        public void allowUsbPrinter(String device) { runOnUiThread(() -> usb.allow(device)); }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); // DinePOS keeps running
    }

    @Override
    protected void onDestroy() {
        if (usb != null) usb.close();
        if (isFinishing()) { DinePosServer.stop(); stopService(new Intent(this, PosService.class)); }
        web.destroy();
        super.onDestroy();
    }
}
