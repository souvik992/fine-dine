package com.dinepos.captain;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * P2-15: asks the shop Wi-Fi "where is the DinePOS server?" (format: packages/shared/src/discovery.ts). One probe to
 * the Wi-Fi's broadcast address and the all-networks one; each server answers this socket alone, and the address is
 * where the answer came from. Blocking: call off the main thread.
 */
public final class Discovery {
    private Discovery() {}

    public static List<FoundServer> discover(Context context, int timeoutMs) {
        Map<String, FoundServer> found = new LinkedHashMap<>();
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            byte[] probe = FoundServer.PROBE.getBytes(StandardCharsets.UTF_8);
            for (InetAddress target : targets(context)) {
                try {
                    socket.send(new DatagramPacket(probe, probe.length, target, FoundServer.DISCOVERY_PORT));
                } catch (IOException e) {
                    // a network that refuses broadcast: whatever does answer is kept
                }
            }
            long end = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[2048];
            while (true) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                socket.setSoTimeout((int) left);
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    socket.receive(p);
                } catch (SocketTimeoutException e) {
                    break;
                }
                if (!(p.getAddress() instanceof Inet4Address)) continue;
                String text = new String(p.getData(), p.getOffset(), p.getLength(), StandardCharsets.UTF_8);
                FoundServer f = FoundServer.parse(text, p.getAddress().getHostAddress());
                if (f != null) found.put(f.url, f);
            }
        } catch (IOException e) {
            // no network at all
        }
        return new ArrayList<>(found.values());
    }

    /** The active network's IPv4 broadcast addresses, and 255.255.255.255. */
    private static List<InetAddress> targets(Context context) {
        Set<InetAddress> out = new LinkedHashSet<>();
        try {
            ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
            Network net = cm == null ? null : cm.getActiveNetwork();
            LinkProperties lp = net == null ? null : cm.getLinkProperties(net);
            if (lp != null) {
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (!(la.getAddress() instanceof Inet4Address)) continue;
                    InetAddress b = broadcastOf(la.getAddress().getAddress(), la.getPrefixLength());
                    if (b != null) out.add(b);
                }
            }
            out.add(InetAddress.getByName("255.255.255.255"));
        } catch (IOException | SecurityException e) {
            // keep what we have
        }
        return new ArrayList<>(out);
    }

    /** 192.168.1.23/24 → 192.168.1.255. Pure (tested). */
    static InetAddress broadcastOf(byte[] address, int prefixLength) {
        if (address.length != 4 || prefixLength < 1 || prefixLength > 30) return null;
        int a = ((address[0] & 255) << 24) | ((address[1] & 255) << 16) | ((address[2] & 255) << 8) | (address[3] & 255);
        int b = a | (-1 >>> prefixLength);
        try {
            return InetAddress.getByAddress(new byte[] {(byte) (b >>> 24), (byte) (b >>> 16), (byte) (b >>> 8), (byte) b});
        } catch (IOException e) {
            return null;
        }
    }
}
