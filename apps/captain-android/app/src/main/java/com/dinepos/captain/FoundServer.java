package com.dinepos.captain;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * A DinePOS server that answered the network probe (P2-15). Parsing follows packages/shared/src/discovery.ts:
 * anything that is not a DinePOS reply is ignored. Pure (tested).
 */
public final class FoundServer {
    /** UDP, the same number as the server's TCP port. */
    public static final int DISCOVERY_PORT = 7420;
    public static final String PROBE = "DINEPOS-DISCOVER 1";

    private static final Pattern SERVER_ID = Pattern.compile("^[0-9A-Za-z_-]{8,64}$");
    private static final Pattern DNS_LABEL = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", Pattern.CASE_INSENSITIVE);

    /** e.g. "http://192.168.1.7:7420": the address is where the reply came from, never what it says. */
    public final String url;
    public final String serverId;
    public final String name;
    public final String host;

    public FoundServer(String url, String serverId, String name, String host) {
        this.url = url;
        this.serverId = serverId;
        this.name = name;
        this.host = host;
    }

    /** The reply `text` from `fromAddress` (an IPv4 address such as "192.168.1.7"), or null when it is not one. */
    public static FoundServer parse(String text, String fromAddress) {
        if (text == null || text.length() > 2048 || fromAddress == null || fromAddress.isEmpty()) return null;
        JSONObject o;
        try {
            Object v = new JSONTokener(text).nextValue();
            if (!(v instanceof JSONObject)) return null;
            o = (JSONObject) v;
        } catch (JSONException e) {
            return null;
        }
        if (!"dinepos-server".equals(o.opt("service")) || !isInt(o.opt("v"), 1, 1)) return null;
        Object id = o.opt("serverId");
        if (!(id instanceof String) || !SERVER_ID.matcher((String) id).matches()) return null;
        Object port = o.opt("port");
        if (!isInt(port, 1, 65_535)) return null;
        Object n = o.opt("name");
        String name = n instanceof String ? ((String) n).substring(0, Math.min(80, ((String) n).length())) : "";
        Object h = o.opt("host");
        String host = h instanceof String && DNS_LABEL.matcher((String) h).matches() ? (String) h : "";
        return new FoundServer("http://" + fromAddress + ":" + ((Number) port).intValue(), (String) id, name, host);
    }

    private static boolean isInt(Object v, int min, int max) {
        if (!(v instanceof Integer || v instanceof Long)) return false;
        long n = ((Number) v).longValue();
        return n >= min && n <= max;
    }

    /**
     * The address of the outlet server with this id: the one we had if it still answers, else the first that
     * answered. Null when that server did not answer.
     */
    public static String pick(List<FoundServer> found, String serverId, String current) {
        if (serverId == null) return null;
        String first = null;
        for (FoundServer f : found) {
            if (!serverId.equals(f.serverId)) continue;
            if (f.url.equals(current)) return f.url;
            if (first == null) first = f.url;
        }
        return first;
    }

    /** One line for the setup list: "Spice Route · pos-master (192.168.1.7:7420)". */
    public String label() {
        String where = url.replaceFirst("^http://", "");
        String who = name.isEmpty() ? "DinePOS server" : name;
        return host.isEmpty() ? who + " (" + where + ")" : who + " · " + host.toLowerCase(Locale.ROOT) + " (" + where + ")";
    }
}
