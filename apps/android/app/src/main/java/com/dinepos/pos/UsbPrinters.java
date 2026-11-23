package com.dinepos.pos;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;

import org.json.JSONObject;

import java.util.Locale;

/**
 * A USB receipt printer plugged into this device (a USB-C cable, an OTG adapter or a POS machine's USB port).
 *
 * <p>Plugging one in starts DinePOS (the manifest's USB_DEVICE_ATTACHED filter, res/xml/usb_printers.xml: USB printer
 * class 7): Android asks "Open DinePOS to handle this printer?" and OK there also lets DinePOS use it. While DinePOS is
 * open, plugging one in asks Android's "Allow DinePOS to access ...?" straight away, so the first bill does not wait for
 * it. Each change is told to the screens (MainActivity › the "dinepos-usb-printer" page event):
 * connected · needs-allow · not-allowed · unplugged, with the printer's name and DinePOS device ("vid:pid").
 */
final class UsbPrinters {
    static final String PERMISSION = "com.dinepos.pos.USB_PERMISSION";

    interface Listener { void event(JSONObject e); }

    private final Activity activity;
    private final UsbManager um;
    private final Listener listener;
    private String lastKey = "";
    private long lastAt;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { handle(i); }
    };

    UsbPrinters(Activity activity, Listener listener) {
        this.activity = activity;
        this.um = (UsbManager) activity.getSystemService(Context.USB_SERVICE);
        this.listener = listener;
        IntentFilter f = new IntentFilter();
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        f.addAction(PERMISSION);
        // system USB broadcasts still arrive with NOT_EXPORTED; the permission answer is our own PendingIntent
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(receiver, f);
    }

    void close() {
        try { activity.unregisterReceiver(receiver); } catch (IllegalArgumentException ignored) { }
    }

    /** The intent DinePOS was opened with, a USB broadcast, or Android's answer to "Allow DinePOS ...?". */
    void handle(Intent i) {
        if (i == null || i.getAction() == null || um == null) return;
        UsbDevice d = device(i);
        if (d == null || PrinterBridge.printerInterface(d) == null) return;
        String action = i.getAction();
        // the same plug-in arrives as the activity intent and as a broadcast
        String key = action + "|" + d.getDeviceName();
        long now = System.currentTimeMillis();
        if (key.equals(lastKey) && now - lastAt < 3000) return;
        lastKey = key;
        lastAt = now;
        switch (action) {
            case UsbManager.ACTION_USB_DEVICE_ATTACHED:
                if (um.hasPermission(d)) emit("connected", d);
                else { emit("needs-allow", d); request(d); }
                break;
            case UsbManager.ACTION_USB_DEVICE_DETACHED:
                emit("unplugged", d);
                break;
            case PERMISSION:
                emit(i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) || um.hasPermission(d) ? "connected" : "not-allowed", d);
                break;
            default:
        }
    }

    /** The screens' Allow button: ask Android again for the printer "vid:pid". */
    void allow(String device) {
        if (um == null || device == null) return;
        String[] p = device.toLowerCase(Locale.ROOT).split(":");
        if (p.length < 2) return;
        for (UsbDevice d : um.getDeviceList().values()) {
            if (!p[0].equals(hex(d.getVendorId())) || !p[1].equals(hex(d.getProductId()))) continue;
            lastKey = "";
            if (um.hasPermission(d)) emit("connected", d); else request(d);
            return;
        }
        JSONObject e = new JSONObject();
        try { e.put("event", "unplugged"); e.put("device", device); e.put("name", "USB printer"); } catch (Exception ignored) { }
        listener.event(e);
    }

    /** Android's "Allow DinePOS to access this USB printer?"; the answer comes back as PERMISSION. */
    static void request(Context ctx, UsbManager um, UsbDevice d) {
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0; // Android adds the device and the answer
        Intent i = new Intent(PERMISSION).setPackage(ctx.getPackageName());
        um.requestPermission(d, PendingIntent.getBroadcast(ctx, 0, i, flags));
    }

    private void request(UsbDevice d) { request(activity, um, d); }

    private void emit(String event, UsbDevice d) {
        JSONObject e = new JSONObject();
        try {
            String product = d.getProductName();
            e.put("event", event);
            e.put("device", hex(d.getVendorId()) + ":" + hex(d.getProductId()));
            e.put("name", product == null || product.trim().isEmpty() ? "USB receipt printer" : product.trim());
        } catch (Exception ignored) { /* JSON with plain strings */ }
        listener.event(e);
    }

    private static String hex(int v) { return String.format(Locale.ROOT, "%04x", v); }

    @SuppressWarnings("deprecation")
    private static UsbDevice device(Intent i) {
        if (Build.VERSION.SDK_INT >= 33) return i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
        return i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
    }
}
