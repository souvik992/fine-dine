package com.dinepos.captain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CaptainConfigTest {
    private final CaptainConfig paired = new CaptainConfig("http://10.0.0.1:7420", "OURSERVER123", "dev_tok.123");

    @Test
    public void theSameOutletAtANewAddressKeepsThePairing() {
        CaptainConfig c = paired.forServer("http://10.0.0.9:7420", "OURSERVER123");
        assertEquals("http://10.0.0.9:7420", c.serverUrl);
        assertEquals("OURSERVER123", c.serverId);
        assertEquals("dev_tok.123", c.deviceToken);
    }

    @Test
    public void anotherOutletStartsFresh() {
        CaptainConfig c = paired.forServer("http://10.0.0.9:7420", "OTHEROUTLET1");
        assertEquals("OTHEROUTLET1", c.serverId);
        assertNull(c.deviceToken);
        assertFalse(paired.isOurs("OTHEROUTLET1"));
    }

    @Test
    public void anUnknownIdKeepsWhatWeHave() {
        CaptainConfig c = paired.forServer("http://10.0.0.9:7420", null);
        assertEquals("OURSERVER123", c.serverId);
        assertEquals("dev_tok.123", c.deviceToken);
        assertTrue(paired.isOurs(null));
        assertTrue(CaptainConfig.EMPTY.isOurs("ANYSERVER123"));
    }

    @Test
    public void keepsOnlyCleanValues() {
        CaptainConfig c = new CaptainConfig("not a url at all ::", "has space", "tok\nnewline");
        assertNull(c.serverUrl);
        assertNull(c.serverId);
        assertNull(c.deviceToken);
        assertNull(CaptainConfig.token(new String(new char[600]).replace('\0', 'a'), 512));
        assertEquals("http://10.0.0.1:7420", new CaptainConfig("10.0.0.1", null, null).serverUrl);
    }
}
