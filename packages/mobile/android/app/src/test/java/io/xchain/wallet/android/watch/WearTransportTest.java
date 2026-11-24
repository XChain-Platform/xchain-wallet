package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.net.Uri;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public class WearTransportTest {

    @Test
    public void noNearbyNodeSendsNothing() {
        FakeBackend backend = new FakeBackend(null);
        WearTransport transport = new WearTransport(backend);
        AtomicBoolean reachable = new AtomicBoolean(true);

        transport.status(reachable::set);
        transport.send(WearPaths.SNAPSHOT, new byte[10]);
        transport.sendImage(hash(), Uri.EMPTY);
        transport.removeWatchData(11L);

        assertFalse(reachable.get());
        assertTrue(backend.liveSends.isEmpty());
        assertEquals(Collections.singletonList("/xc/state:false:11"), backend.dataPuts);
    }

    @Test
    public void payloadAboveOneHundredKilobytesUsesChannel() {
        FakeBackend backend = new FakeBackend("nearby");
        WearTransport transport = new WearTransport(backend);

        transport.send(WearPaths.SNAPSHOT, new byte[100 * 1024 + 1]);

        assertEquals(Collections.singletonList("channel:/xc/snapshot"), backend.liveSends);
    }

    @Test
    public void onlyStatePathIsPutAsDataItem() {
        FakeBackend backend = new FakeBackend("nearby");
        WearTransport transport = new WearTransport(backend);

        transport.send(WearPaths.SNAPSHOT, new byte[1]);
        transport.sendImage(hash(), Uri.EMPTY);
        transport.putState(true, 12L);
        transport.removeWatchData(13L);

        assertEquals(Arrays.asList("/xc/state:true:12", "/xc/state:false:13"), backend.dataPuts);
        assertTrue(backend.liveSends.contains("message:/xc/snapshot"));
        assertTrue(backend.payloads.get(backend.payloads.size() - 1).contains("\"enabled\":false"));
    }

    private static String hash() {
        return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }

    private static final class FakeBackend implements WearTransport.Backend {
        private final String node;
        private final List<String> liveSends = new ArrayList<>();
        private final List<String> dataPuts = new ArrayList<>();
        private final List<String> payloads = new ArrayList<>();

        FakeBackend(String node) {
            this.node = node;
        }

        @Override
        public void nearbyNode(Consumer<String> result) {
            result.accept(node);
        }

        @Override
        public void sendMessage(String node, String path, byte[] payload) {
            liveSends.add("message:" + path);
            payloads.add(new String(payload, StandardCharsets.UTF_8));
        }

        @Override
        public void sendChannel(String node, String path, byte[] payload) {
            liveSends.add("channel:" + path);
        }

        @Override
        public void sendFile(String node, String path, Uri file) {
            liveSends.add("file:" + path);
        }

        @Override
        public void putState(String path, boolean enabled, long builtAt) {
            dataPuts.add(path + ":" + enabled + ":" + builtAt);
        }
    }
}
