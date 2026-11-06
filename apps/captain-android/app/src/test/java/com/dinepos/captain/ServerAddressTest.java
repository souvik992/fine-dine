package com.dinepos.captain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServerAddressTest {
    @Test
    public void addsSchemeAndDefaultPort() {
        assertEquals("http://192.168.1.4:7420", ServerAddress.normalize("192.168.1.4"));
        assertEquals("http://192.168.1.4:7420", ServerAddress.normalize("  192.168.1.4  "));
        assertEquals("http://pos-master.local:7420", ServerAddress.normalize("POS-Master.local"));
    }

    @Test
    public void keepsATypedPortAndDropsThePath() {
        assertEquals("http://192.168.1.4:8080", ServerAddress.normalize("192.168.1.4:8080"));
        assertEquals("http://192.168.1.4:7420", ServerAddress.normalize("http://192.168.1.4:7420/captain/tables?x=1"));
        assertEquals("https://pos.example", ServerAddress.normalize("https://pos.example"));
    }

    @Test
    public void aTypedDefaultPortMeansNoPort() {
        assertEquals("http://192.168.1.4", ServerAddress.normalize("http://192.168.1.4:80"));
        assertEquals("http://192.168.1.4", ServerAddress.normalize("192.168.1.4:80"));
    }

    @Test
    public void refusesWhatIsNotAServer() {
        assertNull(ServerAddress.normalize(""));
        assertNull(ServerAddress.normalize("   "));
        assertNull(ServerAddress.normalize(null));
        assertNull(ServerAddress.normalize("file:///sdcard/x.html"));
        assertNull(ServerAddress.normalize("javascript:alert(1)"));
        assertNull(ServerAddress.normalize("intent://x#Intent;end"));
        assertNull(ServerAddress.normalize("http://user:pw@192.168.1.4"));
        assertNull(ServerAddress.normalize("http://192.168.1.4:99999"));
        assertNull(ServerAddress.normalize("http://exa mple"));
    }

    @Test
    public void opensOnlyTheServersOwnPages() {
        String s = "http://192.168.1.4:7420";
        assertTrue(ServerAddress.mayOpen("http://192.168.1.4:7420/captain/", s));
        assertTrue(ServerAddress.mayOpen("http://192.168.1.4:7420/v1/health", s));
        assertFalse(ServerAddress.mayOpen("http://192.168.1.4:8080/captain/", s));
        assertFalse(ServerAddress.mayOpen("https://192.168.1.4:7420/captain/", s));
        assertFalse(ServerAddress.mayOpen("http://192.168.1.5:7420/captain/", s));
        assertFalse(ServerAddress.mayOpen("https://example.com/", s));
        assertFalse(ServerAddress.mayOpen("tel:123", s));
        assertFalse(ServerAddress.mayOpen("intent://scan/#Intent;scheme=x;end", s));
        assertFalse(ServerAddress.mayOpen("about:blank", s));
        assertFalse(ServerAddress.mayOpen("http://192.168.1.4:7420/", null));
        assertTrue(ServerAddress.mayOpen("http://h/x", "http://h:80"));
    }

    @Test
    public void knowsTheCaptainPage() {
        String s = "http://192.168.1.4:7420";
        assertEquals("http://192.168.1.4:7420/captain/", ServerAddress.captainUrl(s));
        assertTrue(ServerAddress.isCaptainPage("http://192.168.1.4:7420/captain/", s));
        assertTrue(ServerAddress.isCaptainPage("http://192.168.1.4:7420/captain/tables/T7", s));
        assertFalse(ServerAddress.isCaptainPage("http://192.168.1.4:7420/v1/health", s));
        assertFalse(ServerAddress.isCaptainPage("http://192.168.1.4:7420/captainx", s));
        assertFalse(ServerAddress.isCaptainPage("http://192.168.1.9:7420/captain/", s));
        assertFalse(ServerAddress.isCaptainPage(null, s));
    }
}
