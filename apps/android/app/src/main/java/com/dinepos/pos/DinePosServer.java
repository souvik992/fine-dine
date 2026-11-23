package com.dinepos.pos;

import android.content.Context;
import android.content.res.AssetManager;
import android.provider.Settings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;

/**
 * Runs the DinePOS outlet server on this device: the same server as on Windows (apps/server, bundled for Android with
 * node:sqlite), on Node 24 for Android, as a child process of this app. Node and its libraries are in the app's native
 * library folder (the only place Android allows running programs from); the server and its screens are unpacked from
 * the APK once per version. Bills live in files/dinepos-data. It listens on port 7420 of every network, so captain
 * phones and kitchen screens on the Wi-Fi connect to this device as they would to the main PC.
 */
final class DinePosServer {
    interface Listener { void ready(); void failed(String message); }

    static final int PORT = 7420;

    private static Process process;
    private static OutputStream stdin;
    private static PrinterBridge bridge;

    private DinePosServer() {}

    /** Starts the server on a background thread (or finds it running) and reports when it answers. */
    static synchronized void start(Context ctx, Listener listener) {
        new Thread(() -> {
            try {
                if (answers()) { listener.ready(); return; } // already running (the window was recreated)
                synchronized (DinePosServer.class) { if (process != null && process.isAlive()) { waitReady(ctx, process, listener); return; } }
                File app = unpack(ctx);
                File data = new File(ctx.getFilesDir(), "dinepos-data");
                if (!data.isDirectory() && !data.mkdirs()) throw new IOException("Cannot create the data folder.");
                String nativeDir = ctx.getApplicationInfo().nativeLibraryDir;
                File server = new File(app, "server");
                ProcessBuilder pb = new ProcessBuilder(nativeDir + "/libdineposnode.so", new File(server, "server.mjs").getPath());
                Map<String, String> env = pb.environment();
                env.put("LD_LIBRARY_PATH", nativeDir);
                env.put("HOME", ctx.getFilesDir().getPath());
                env.put("TMPDIR", ctx.getCacheDir().getPath());
                env.put("NODE_ENV", "production");
                env.put("DATA_DIR", data.getPath());
                env.put("DINEPOS_PORT", String.valueOf(PORT));
                env.put("DINEPOS_HOST", "0.0.0.0");
                env.put("DINEPOS_STOP_WITH_STDIN", "1");
                // the licence's hardware id: this device's own id (per app signing key)
                String androidId = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
                if (androidId != null) env.put("DINEPOS_ANDROID_ID", androidId);
                synchronized (DinePosServer.class) { if (bridge == null) bridge = new PrinterBridge(ctx); }
                env.put("DINEPOS_ANDROID_BRIDGE", bridge.start()); // USB and Bluetooth printers through this app
                pb.directory(server);
                pb.redirectErrorStream(true);
                pb.redirectOutput(ProcessBuilder.Redirect.appendTo(new File(ctx.getFilesDir(), "dinepos-server.log")));
                Process p = pb.start();
                synchronized (DinePosServer.class) { process = p; stdin = p.getOutputStream(); }
                waitReady(ctx, p, listener);
            } catch (Exception e) {
                listener.failed("DinePOS could not start: " + e.getMessage());
            }
        }, "dinepos-server-start").start();
    }

    private static void waitReady(Context ctx, Process p, Listener listener) throws InterruptedException {
        long until = System.currentTimeMillis() + 180_000; // the first start on a slow device builds the database
        while (System.currentTimeMillis() < until) {
            if (answers()) { listener.ready(); return; }
            if (!p.isAlive()) { listener.failed("DinePOS stopped while starting (code " + p.exitValue() + "). " + lastLog(ctx)); return; }
            Thread.sleep(250);
        }
        listener.failed("DinePOS took too long to start. " + lastLog(ctx));
    }

    /** Whether the server on this device answers its health check (any answer: it is up). */
    static boolean answers() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + PORT + "/v1/health").openConnection();
            c.setConnectTimeout(500);
            c.setReadTimeout(1500);
            int code = c.getResponseCode();
            c.disconnect();
            return code > 0;
        } catch (IOException e) { return false; }
    }

    /** Asks the server to finish its work and stop (closing its input), then makes sure it is gone. */
    static synchronized void stop() {
        Process p = process;
        process = null;
        if (p == null) return;
        try { if (stdin != null) stdin.close(); } catch (IOException ignored) { }
        new Thread(() -> {
            try { if (!p.waitFor(12, java.util.concurrent.TimeUnit.SECONDS)) p.destroy(); } catch (InterruptedException ignored) { p.destroy(); }
        }, "dinepos-server-stop").start();
    }

    /** Unpacks assets/dinepos (server + screens) into files/dinepos-app/<fingerprint> unless that version is there. */
    private static File unpack(Context ctx) throws IOException {
        AssetManager am = ctx.getAssets();
        String fp;
        try (InputStream in = am.open("dinepos/fingerprint.txt")) { fp = new String(readAll(in), StandardCharsets.UTF_8).trim(); }
        File root = new File(ctx.getFilesDir(), "dinepos-app");
        File dir = new File(root, fp);
        if (new File(dir, ".complete").isFile()) return dir;
        File tmp = new File(root, fp + ".tmp");
        deleteTree(tmp);
        copyAssets(am, "dinepos", tmp);
        if (!new File(tmp, ".complete").createNewFile() || !tmp.renameTo(dir)) throw new IOException("Cannot unpack the DinePOS files.");
        File[] old = root.listFiles();
        if (old != null) for (File f : old) if (!f.getName().equals(fp)) deleteTree(f);
        return dir;
    }

    private static void copyAssets(AssetManager am, String path, File to) throws IOException {
        String[] list = am.list(path);
        if (list == null || list.length == 0) { // a file
            File parent = to.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
            try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            }
            return;
        }
        if (!to.isDirectory() && !to.mkdirs()) throw new IOException("Cannot create " + to);
        for (String name : list) copyAssets(am, path + "/" + name, new File(to, name));
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
        return b.toByteArray();
    }

    /** The last lines of the server's log, to show with a start-up error. */
    private static String lastLog(Context ctx) {
        try {
            byte[] all = Files.readAllBytes(new File(ctx.getFilesDir(), "dinepos-server.log").toPath());
            int from = Math.max(0, all.length - 600);
            return new String(all, from, all.length - from, StandardCharsets.UTF_8).trim();
        } catch (IOException e) { return ""; }
    }
}
