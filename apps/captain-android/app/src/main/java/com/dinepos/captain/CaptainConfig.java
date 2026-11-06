package com.dinepos.captain;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * What the app remembers (immutable; kept by {@link ConfigStore}). Pure (tested).
 *
 * <p>P2-15: browser storage belongs to one address, so after the main PC gets a new IP address the app puts the phone's
 * pairing (device token) into the new address's storage, and the phone stays paired. The copy is only ever given back
 * to the same serverId; another outlet starts fresh.
 */
public final class CaptainConfig {
    /** The captain page's own storage key (apps/captain: storagePrefix "dinepos.captain", @dinepos/web-shell). */
    public static final String DEVICE_KEY = "dinepos.captain.device";

    private static final Pattern TOKEN = Pattern.compile("^[!-~]+$");

    /** The outlet server, e.g. "http://192.168.1.4:7420" (no path), or null before setup. */
    public final String serverUrl;
    /** Which outlet server that is (GET /v1/health), so the app can follow it to a new IP address. */
    public final String serverId;
    /** A copy of the phone's pairing, kept by the page in the server address's storage. */
    public final String deviceToken;

    public static final CaptainConfig EMPTY = new CaptainConfig(null, null, null);

    public CaptainConfig(String serverUrl, String serverId, String deviceToken) {
        this.serverUrl = serverUrl == null ? null : ServerAddress.normalize(serverUrl);
        this.serverId = token(serverId, 64);
        this.deviceToken = token(deviceToken, 512);
    }

    /** Printable ASCII, no spaces, at most `max` characters; anything else is not kept. */
    public static String token(String v, int max) {
        return v != null && !v.isEmpty() && v.length() <= max && TOKEN.matcher(v).matches() ? v : null;
    }

    /** Connecting to `serverId` at `serverUrl`: a different outlet starts again (new pairing); the same one keeps it. */
    public CaptainConfig forServer(String serverUrl, String serverId) {
        boolean same = this.serverId == null || serverId == null || this.serverId.equals(serverId);
        return new CaptainConfig(serverUrl, serverId != null ? serverId : this.serverId, same ? deviceToken : null);
    }

    public CaptainConfig withDeviceToken(String deviceToken) {
        return new CaptainConfig(serverUrl, serverId, deviceToken);
    }

    /** The health answer is the saved outlet (or one of the two does not know its id yet). */
    public boolean isOurs(String answeredServerId) {
        return serverId == null || answeredServerId == null || serverId.equals(answeredServerId);
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof CaptainConfig)) return false;
        CaptainConfig c = (CaptainConfig) o;
        return Objects.equals(serverUrl, c.serverUrl) && Objects.equals(serverId, c.serverId) && Objects.equals(deviceToken, c.deviceToken);
    }

    @Override
    public int hashCode() {
        return Objects.hash(serverUrl, serverId, deviceToken);
    }
}
