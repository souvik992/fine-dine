package com.dinepos.captain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PageScriptsTest {
    @Test
    public void captureAndSeedUseTheCaptainsKey() {
        assertEquals("localStorage.getItem(\"dinepos.captain.device\")", PageScripts.captureDevice());
        String seed = PageScripts.seedDevice("tok\"</script>");
        assertTrue(seed.contains("if (!localStorage.getItem(\"dinepos.captain.device\"))"));
        assertTrue("quoted, and </ escaped", seed.contains("\"tok\\\"<\\/script>\""));
        assertEquals("true", PageScripts.seedDevice(null));
    }

    @Test
    public void decodesEvaluateJavascriptResults() {
        assertEquals("abc", PageScripts.decodeString("\"abc\""));
        assertEquals("[{\"seq\":1}]", PageScripts.decodeString("\"[{\\\"seq\\\":1}]\""));
        assertNull(PageScripts.decodeString("null"));
        assertNull(PageScripts.decodeString("12"));
        assertNull(PageScripts.decodeString(null));
        assertNull(PageScripts.decodeString("{bad"));
    }

    @Test
    public void checksAnExportedOutbox() {
        String one = "[{\"seq\":3,\"commandId\":\"01JCMD0000000000000000000A\",\"type\":\"AddItems\",\"payload\":{\"x\":1}}]";
        String checked = PageScripts.checkExport(one);
        assertEquals(1, PageScripts.count(checked));
        assertTrue(checked.contains("\"payload\":{\"x\":1}"));
        assertEquals("[]", PageScripts.checkExport("[]"));
        assertEquals(0, PageScripts.count("[]"));
        assertNull(PageScripts.checkExport(PageScripts.FAILED));
        assertNull(PageScripts.checkExport(null));
        assertNull(PageScripts.checkExport("{\"seq\":1}"));
        assertNull(PageScripts.checkExport("[1]"));
        assertNull(PageScripts.checkExport("[{\"seq\":\"1\",\"commandId\":\"a\"}]"));
        assertNull(PageScripts.checkExport("[{\"seq\":0,\"commandId\":\"a\"}]"));
        assertNull(PageScripts.checkExport("[{\"seq\":1.5,\"commandId\":\"a\"}]"));
        assertNull(PageScripts.checkExport("[{\"seq\":1}]"));
        assertNull(PageScripts.checkExport("[{\"seq\":1,\"commandId\":\"has space\"}]"));
    }

    @Test
    public void exportNeverCreatesTheDatabaseAndImportMatchesTheCaptainsSchema() {
        String exp = PageScripts.exportOutbox();
        assertTrue(exp.contains("indexedDB.open(\"dinepos-captain\")"));
        assertTrue("an upgrade (= no database yet) is aborted", exp.contains("r.transaction.abort()"));
        assertTrue(exp.contains("window." + PageScripts.EXPORT_VAR));

        String imp = PageScripts.importOutbox("[{\"seq\":1,\"commandId\":\"c1\"}]");
        assertTrue(imp.contains("createObjectStore(\"outbox\",{keyPath:'seq'})"));
        assertTrue(imp.contains("createObjectStore('cache')"));
        assertTrue("skips entries already there", imp.contains("if(ids[e.commandId])return;"));
        assertTrue("entries arrive as a string literal, parsed in the page", imp.endsWith("(JSON.parse(\"[{\\\"seq\\\":1,\\\"commandId\\\":\\\"c1\\\"}]\"))"));
        assertFalse(imp.contains("eval("));
        assertEquals("(function(){var v=window.__x;return v===undefined?null:v;})()", PageScripts.read("__x"));
    }
}
