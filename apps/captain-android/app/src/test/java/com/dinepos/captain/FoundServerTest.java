package com.dinepos.captain;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class FoundServerTest {
    private static final String OK = "{\"service\":\"dinepos-server\",\"v\":1,\"serverId\":\"01JABCDEFG1234\",\"name\":\"Spice Route\",\"host\":\"pos-master\",\"port\":7420}";

    @Test
    public void readsAReplyAndTakesTheAddressFromWhereItCameFrom() {
        FoundServer f = FoundServer.parse(OK, "192.168.1.7");
        assertNotNull(f);
        assertEquals("http://192.168.1.7:7420", f.url);
        assertEquals("01JABCDEFG1234", f.serverId);
        assertEquals("Spice Route", f.name);
        assertEquals("pos-master", f.host);
        assertEquals("Spice Route · pos-master (192.168.1.7:7420)", f.label());
    }

    @Test
    public void ignoresAnythingElse() {
        assertNull(FoundServer.parse("DINEPOS-DISCOVER 1", "192.168.1.7"));
        assertNull(FoundServer.parse("[]", "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("dinepos-server", "other"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("\"v\":1", "\"v\":2"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("\"v\":1", "\"v\":1.5"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("01JABCDEFG1234", "short"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("01JABCDEFG1234", "bad id with spaces"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("7420", "70000"), "192.168.1.7"));
        assertNull(FoundServer.parse(OK.replace("7420", "\"7420\""), "192.168.1.7"));
        assertNull(FoundServer.parse(OK, null));
        char[] big = new char[3000];
        Arrays.fill(big, ' ');
        assertNull(FoundServer.parse(new String(big) + OK, "192.168.1.7"));
    }

    @Test
    public void dropsABadHostAndCutsALongName() {
        String longName = new String(new char[100]).replace('\0', 'a');
        FoundServer f = FoundServer.parse(OK.replace("pos-master", "not a host").replace("Spice Route", longName), "10.0.0.2");
        assertNotNull(f);
        assertEquals("", f.host);
        assertEquals(80, f.name.length());
    }

    @Test
    public void picksOnlyOurServerPreferringTheAddressWeHad() {
        List<FoundServer> found = Arrays.asList(
            new FoundServer("http://10.0.0.5:7420", "OTHEROUTLET1", "", ""),
            new FoundServer("http://10.0.0.8:7420", "OURSERVER123", "", ""),
            new FoundServer("http://10.0.0.9:7420", "OURSERVER123", "", ""));
        assertEquals("http://10.0.0.8:7420", FoundServer.pick(found, "OURSERVER123", "http://10.0.0.1:7420"));
        assertEquals("http://10.0.0.9:7420", FoundServer.pick(found, "OURSERVER123", "http://10.0.0.9:7420"));
        assertNull(FoundServer.pick(found, "NOTHERE12345", null));
        assertNull(FoundServer.pick(found, null, null));
        assertNull(FoundServer.pick(Collections.emptyList(), "OURSERVER123", null));
    }

    @Test
    public void broadcastAddress() {
        assertEquals("192.168.1.255", Discovery.broadcastOf(new byte[] {(byte) 192, (byte) 168, 1, 23}, 24).getHostAddress());
        assertEquals("10.0.255.255", Discovery.broadcastOf(new byte[] {10, 0, 3, 4}, 16).getHostAddress());
        assertEquals("172.16.7.255", Discovery.broadcastOf(new byte[] {(byte) 172, 16, 6, 1}, 23).getHostAddress());
        assertNull(Discovery.broadcastOf(new byte[] {10, 0, 0, 1}, 32));
        assertNull(Discovery.broadcastOf(new byte[] {1, 2, 3}, 24));
    }
}
