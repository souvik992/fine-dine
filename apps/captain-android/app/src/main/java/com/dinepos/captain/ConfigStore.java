package com.dinepos.captain;

import android.content.Context;
import android.content.SharedPreferences;

/** The saved {@link CaptainConfig}, and an outbox copy on its way to a new server address (app-private storage). */
public final class ConfigStore {
    private static final String FILE = "captain";
    private static final String SERVER_URL = "serverUrl";
    private static final String SERVER_ID = "serverId";
    private static final String DEVICE_TOKEN = "deviceToken";
    /** Outbox entries read at the old address, kept until the new address has them (survives the app being closed). */
    private static final String MOVING_OUTBOX = "movingOutbox";

    private final SharedPreferences prefs;

    public ConfigStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public CaptainConfig load() {
        return new CaptainConfig(prefs.getString(SERVER_URL, null), prefs.getString(SERVER_ID, null), prefs.getString(DEVICE_TOKEN, null));
    }

    public void save(CaptainConfig c) {
        prefs.edit().putString(SERVER_URL, c.serverUrl).putString(SERVER_ID, c.serverId).putString(DEVICE_TOKEN, c.deviceToken).apply();
    }

    public String movingOutbox() {
        return prefs.getString(MOVING_OUTBOX, null);
    }

    public void setMovingOutbox(String checkedEntries) {
        if (checkedEntries == null) prefs.edit().remove(MOVING_OUTBOX).commit();
        else prefs.edit().putString(MOVING_OUTBOX, checkedEntries).commit();
    }
}
