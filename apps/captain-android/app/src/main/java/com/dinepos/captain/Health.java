package com.dinepos.captain;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** GET /v1/health: is a DinePOS server there, and which outlet is it. Blocking: call off the main thread. */
public final class Health {
    private Health() {}

    public static final class Result {
        public final boolean ok;
        public final String serverId;
        public final String problem;

        private Result(boolean ok, String serverId, String problem) {
            this.ok = ok;
            this.serverId = serverId;
            this.problem = problem;
        }
    }

    public static Result check(String serverUrl) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(ServerAddress.healthUrl(serverUrl)).openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "application/json");
            int status = c.getResponseCode();
            if (status != 200) return new Result(false, null, "The server at " + serverUrl + " answered " + status + ".");
            Object j = new JSONTokener(readSmall(c.getInputStream())).nextValue();
            if (!(j instanceof JSONObject)) return new Result(false, null, serverUrl + " is not a DinePOS server.");
            Object id = ((JSONObject) j).opt("serverId");
            return new Result(true, id instanceof String ? CaptainConfig.token((String) id, 64) : null, null);
        } catch (IOException | JSONException | ClassCastException e) {
            return new Result(false, null, "Cannot reach the DinePOS server at " + serverUrl
                + ". Is the main PC on with DinePOS Server open, and is this phone on the shop Wi-Fi?");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readSmall(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 64 * 1024) throw new IOException("health answer too large");
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
