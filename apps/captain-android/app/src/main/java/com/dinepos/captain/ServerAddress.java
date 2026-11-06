package com.dinepos.captain;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Where the outlet server is, and what the captain window may open. Pure (tested). The same rules as DinePOS Kitchen
 * (apps/kitchen/electron/config.ts): only http(s), a host and a port; the server's own pages only.
 */
public final class ServerAddress {
    private ServerAddress() {}

    /** The server's TCP port (docs/01). */
    public static final int DEFAULT_PORT = 7420;

    private static final Pattern HAS_SCHEME = Pattern.compile("^[a-z][a-z0-9+.-]*://", Pattern.CASE_INSENSITIVE);
    private static final Pattern PORT_TYPED = Pattern.compile("^https?://[^/?#]*:\\d+", Pattern.CASE_INSENSITIVE);

    /**
     * "192.168.1.4", "192.168.1.4:7420", "http://192.168.1.4:7420/captain" → "http://192.168.1.4:7420". Null when it
     * is not a server address.
     */
    public static String normalize(String input) {
        if (input == null) return null;
        String raw = input.trim();
        if (raw.isEmpty()) return null;
        String withScheme = HAS_SCHEME.matcher(raw).find() ? raw : "http://" + raw;
        URI u;
        try {
            u = new URI(withScheme);
        } catch (URISyntaxException e) {
            return null;
        }
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        String host = u.getHost();
        if (host == null || host.isEmpty() || u.getRawUserInfo() != null) return null;
        int port = u.getPort();
        if (port > 65_535) return null;
        boolean typed = PORT_TYPED.matcher(withScheme).find();
        if (port == defaultPort(scheme)) port = -1; // ":80" on http means no port, as in a browser
        else if (port < 0 && !typed && scheme.equals("http")) port = DEFAULT_PORT;
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (port > 0 ? ":" + port : "");
    }

    /** The captain app on that server (served at /captain/, apps/server/src/routes/web-apps.ts). */
    public static String captainUrl(String serverUrl) {
        return serverUrl + "/captain/";
    }

    public static String healthUrl(String serverUrl) {
        return serverUrl + "/v1/health";
    }

    /** "http://h:7420", or null: what decides whether two addresses share browser storage. */
    public static String origin(String url) {
        if (url == null) return null;
        try {
            URI u = new URI(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            if (u.getHost() == null || u.getHost().isEmpty()) return null;
            int port = u.getPort() < 0 ? defaultPort(scheme) : u.getPort();
            return scheme + "://" + u.getHost().toLowerCase(Locale.ROOT) + ":" + port;
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** Whether the captain window may go to `url`: the server's own pages only (no other site, no file:, no intent:). */
    public static boolean mayOpen(String url, String serverUrl) {
        String a = origin(url);
        return a != null && a.equals(origin(serverUrl));
    }

    /** Whether `url` is the captain app on that server (not the health page used for seeding, not an error page). */
    public static boolean isCaptainPage(String url, String serverUrl) {
        if (!mayOpen(url, serverUrl)) return false;
        try {
            String path = new URI(url).getPath();
            return path != null && (path.equals("/captain") || path.startsWith("/captain/"));
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static int defaultPort(String scheme) {
        return scheme.equals("https") ? 443 : 80;
    }
}
