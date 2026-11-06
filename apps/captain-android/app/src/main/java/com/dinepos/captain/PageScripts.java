package com.dinepos.captain;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * JavaScript the app runs in pages of the server's address, and checks on what comes back (the page is the server's,
 * but what it returns is still input). Pure (tested).
 *
 * <p>Two things live in the page's own storage, which belongs to one address: the pairing (localStorage,
 * {@link CaptainConfig#DEVICE_KEY}) and the offline outbox (IndexedDB "dinepos-captain", store "outbox", key "seq";
 * apps/captain/src/offline/idb.ts). When the main PC gets a new IP address both are copied to the new address before
 * the captain app starts there, so the phone stays paired and orders taken while the Wi-Fi was down are still sent.
 * Every outbox entry keeps its commandId, so one sent twice is answered DUPLICATE, never applied twice.
 */
public final class PageScripts {
    private PageScripts() {}

    /** Window variables the asynchronous scripts leave their answer in (read with {@link #read}). */
    public static final String EXPORT_VAR = "__dineposCaptainExport";
    public static final String IMPORT_VAR = "__dineposCaptainImport";

    public static final String FAILED = "error";
    public static final String IMPORTED = "done";

    /** Outbox entries are small; anything bigger than this is not an outbox. */
    public static final int MAX_EXPORT_CHARS = 4_000_000;

    private static final String DB = "dinepos-captain";
    private static final String STORE = "outbox";

    /** What the page keeps as its pairing now (the evaluateJavascript result is that value, JSON-encoded). */
    public static String captureDevice() {
        return "localStorage.getItem(" + q(CaptainConfig.DEVICE_KEY) + ")";
    }

    /** The saved pairing, only where this address has none (what the page keeps there may be newer). */
    public static String seedDevice(String deviceToken) {
        if (deviceToken == null) return "true";
        String k = q(CaptainConfig.DEVICE_KEY);
        return "if (!localStorage.getItem(" + k + ")) localStorage.setItem(" + k + ", " + q(deviceToken) + "); true";
    }

    /**
     * Leaves the outbox as a JSON array in {@link #EXPORT_VAR} ("[]" when there is none, {@link #FAILED} when it cannot
     * be read). Never creates the database: an empty one would stop the captain app making its own.
     */
    public static String exportOutbox() {
        String v = "window." + EXPORT_VAR;
        return "(function(){" + v + "=undefined;var put=function(x){" + v + "=x;};"
            + "try{var list=indexedDB.databases?indexedDB.databases():Promise.resolve(null);"
            + "list.then(function(dbs){"
            + "if(dbs&&!dbs.some(function(d){return d.name===" + q(DB) + ";})){put('[]');return;}"
            + "var fresh=false,r=indexedDB.open(" + q(DB) + ");"
            + "r.onupgradeneeded=function(){fresh=true;r.transaction.abort();};"
            + "r.onerror=function(){put(fresh?'[]':" + q(FAILED) + ");};"
            + "r.onsuccess=function(){var db=r.result;"
            + "if(!db.objectStoreNames.contains(" + q(STORE) + ")){db.close();put('[]');return;}"
            + "var g=db.transaction(" + q(STORE) + ",'readonly').objectStore(" + q(STORE) + ").getAll();"
            + "g.onsuccess=function(){db.close();put(JSON.stringify(g.result));};"
            + "g.onerror=function(){db.close();put(" + q(FAILED) + ");};};"
            + "},function(){put(" + q(FAILED) + ");});"
            + "}catch(e){put(" + q(FAILED) + ");}return true;})()";
    }

    /**
     * Adds the checked entries to this address's outbox, oldest first; entries already there (same commandId) are
     * skipped, and when there are some, the new ones go after them. Creates the database as the captain app does
     * (version 1: "outbox" keyed by seq, "cache") when this address has none yet. Leaves {@link #IMPORTED} or
     * {@link #FAILED} in {@link #IMPORT_VAR}.
     */
    public static String importOutbox(String checkedEntries) {
        String v = "window." + IMPORT_VAR;
        return "(function(entries){" + v + "=undefined;var put=function(x){" + v + "=x;};"
            + "try{entries.sort(function(a,b){return a.seq-b.seq;});"
            + "var r=indexedDB.open(" + q(DB) + ");"
            + "r.onupgradeneeded=function(){var db=r.result;"
            + "if(!db.objectStoreNames.contains(" + q(STORE) + "))db.createObjectStore(" + q(STORE) + ",{keyPath:'seq'});"
            + "if(!db.objectStoreNames.contains('cache'))db.createObjectStore('cache');};"
            + "r.onerror=function(){put(" + q(FAILED) + ");};"
            + "r.onsuccess=function(){var db=r.result;"
            + "if(!db.objectStoreNames.contains(" + q(STORE) + ")){db.close();put(" + q(FAILED) + ");return;}"
            + "var tx=db.transaction(" + q(STORE) + ",'readwrite');var st=tx.objectStore(" + q(STORE) + ");"
            + "var g=st.getAll();"
            + "g.onsuccess=function(){var have=g.result,ids={},max=0,n=0;"
            + "have.forEach(function(e){ids[e.commandId]=1;if(e.seq>max)max=e.seq;});"
            + "entries.forEach(function(e){if(ids[e.commandId])return;n++;var c=Object.assign({},e);"
            + "if(have.length)c.seq=max+n;st.put(c);});};"
            + "tx.oncomplete=function(){db.close();put(" + q(IMPORTED) + ");};"
            + "tx.onerror=tx.onabort=function(){db.close();put(" + q(FAILED) + ");};};"
            + "}catch(e){put(" + q(FAILED) + ");}return true;})(JSON.parse(" + q(checkedEntries) + "))";
    }

    /** Reads a window variable left by an asynchronous script (null until it is set). */
    public static String read(String var) {
        return "(function(){var v=window." + var + ";return v===undefined?null:v;})()";
    }

    /** An evaluateJavascript result (JSON) that is a string, or null. */
    public static String decodeString(String evaluated) {
        if (evaluated == null) return null;
        try {
            Object v = new JSONTokener(evaluated).nextValue();
            return v instanceof String ? (String) v : null;
        } catch (JSONException e) {
            return null;
        }
    }

    /**
     * The exported outbox, checked: a JSON array of objects, each with a whole-number seq and a string commandId.
     * Returns it re-serialised (so only what was checked is imported), "[]" for none, or null when it is not an outbox.
     */
    public static String checkExport(String exported) {
        if (exported == null || exported.length() > MAX_EXPORT_CHARS) return null;
        try {
            Object v = new JSONTokener(exported).nextValue();
            if (!(v instanceof JSONArray)) return null;
            JSONArray a = (JSONArray) v;
            for (int i = 0; i < a.length(); i++) {
                Object e = a.get(i);
                if (!(e instanceof JSONObject)) return null;
                Object seq = ((JSONObject) e).opt("seq");
                Object id = ((JSONObject) e).opt("commandId");
                if (!(seq instanceof Integer || seq instanceof Long) || ((Number) seq).longValue() < 1) return null;
                if (!(id instanceof String) || CaptainConfig.token((String) id, 64) == null) return null;
            }
            return a.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    /** How many entries a checked export holds. */
    public static int count(String checkedEntries) {
        try {
            return new JSONArray(checkedEntries).length();
        } catch (JSONException e) {
            return 0;
        }
    }

    /** A JavaScript string literal (JSON string syntax; "</" is escaped). */
    static String q(String s) {
        return JSONObject.quote(s);
    }
}
