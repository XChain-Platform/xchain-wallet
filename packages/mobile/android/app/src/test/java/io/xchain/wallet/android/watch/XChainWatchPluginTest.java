/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.net.Uri;

import com.getcapacitor.JSObject;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.function.Consumer;

@RunWith(RobolectricTestRunner.class)
public final class XChainWatchPluginTest {

    @Rule public final TemporaryFolder temporary = new TemporaryFolder();

    private RecordingBackend backend;
    private RecordingPlugin plugin;

    @Before
    public void setUp() {
        backend = new RecordingBackend("nearby");
        plugin = new RecordingPlugin(true, new WearTransport(backend),
                result -> result.accept(new XChainWatchPlugin.LinkState(true, true, true)),
                temporary.getRoot());
    }

    @Test
    public void sendsSnapshotDetailImageAndRemoveThroughTransport() throws Exception {
        String snapshot = "{\"v\":1,\"builtAt\":17,\"settings\":{\"enabled\":true}}";
        String detail = "{\"v\":1,\"tokenId\":\"bitcoin-mainnet:BTC\"}";
        byte[] png = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1};
        String hash = hex(MessageDigest.getInstance("SHA-256").digest(png));

        assertTrue(plugin.sendSnapshotJson(snapshot));
        assertTrue(plugin.sendDetailJson(detail));
        assertTrue(plugin.sendImageData(hash, Base64.getEncoder().encodeToString(png)));
        plugin.removeWatchDataAt(19L);

        assertEquals("message:/xc/snapshot", backend.sends.get(0));
        assertEquals("message:/xc/detail/bitcoin-mainnet:BTC", backend.sends.get(1));
        assertEquals("file:/xc/image/" + hash, backend.sends.get(2));
        assertEquals("message:/xc/snapshot", backend.sends.get(3));
        assertEquals("/xc/state:true:17", backend.states.get(0));
        assertEquals("/xc/state:false:19", backend.states.get(1));
        assertNotNull(backend.file);
        assertTrue(backend.file.getPath().endsWith(hash));
    }

    @Test
    public void rejectsMalformedPayloadsWithoutSending() {
        assertFalse(plugin.sendSnapshotJson("{}"));
        assertFalse(plugin.sendDetailJson("{\"v\":1}"));
        assertFalse(plugin.sendImageData("bad", "bad"));

        assertTrue(backend.sends.isEmpty());
        assertTrue(backend.states.isEmpty());
    }

    @Test
    public void nearbyArrivalResendsLastSnapshot() {
        assertTrue(plugin.sendSnapshotJson(
                "{\"v\":1,\"builtAt\":23,\"settings\":{\"enabled\":true}}"));

        plugin.onWatchNearby();

        assertEquals(2, backend.payloads.size());
        assertEquals(backend.payloads.get(0), backend.payloads.get(1));
    }

    @Test
    public void statusNormalizesLinkStateAndKeepsLastSync() throws Exception {
        assertTrue(plugin.sendSnapshotJson(
                "{\"v\":1,\"builtAt\":29,\"settings\":{\"enabled\":true}}"));
        List<JSObject> answers = new ArrayList<>();

        plugin.statusMap(answers::add);

        assertEquals(1, answers.size());
        assertTrue(answers.get(0).getBool("paired"));
        assertTrue(answers.get(0).getBool("installed"));
        assertTrue(answers.get(0).getBool("reachable"));
        assertEquals(29L, answers.get(0).getLong("lastSyncAt"));
    }

    @Test
    public void unavailableStatusDoesNotProbeAndForcesFalse() {
        boolean[] probed = {false};
        XChainWatchPlugin unavailable = new XChainWatchPlugin(false, new WearTransport(backend),
                result -> probed[0] = true, temporary.getRoot());
        List<JSObject> answers = new ArrayList<>();

        unavailable.statusMap(answers::add);

        assertFalse(probed[0]);
        assertFalse(answers.get(0).getBool("paired"));
        assertFalse(answers.get(0).getBool("installed"));
        assertFalse(answers.get(0).getBool("reachable"));
    }

    @Test
    public void routerCallbackPublishesJsonIntentAndDropsInvalidJson() {
        plugin.onIntent("markRead", "{\"id\":\"alert-1\"}".getBytes(StandardCharsets.UTF_8));
        plugin.onIntent("markRead", "not json".getBytes(StandardCharsets.UTF_8));

        assertEquals(1, plugin.events.size());
        assertEquals("markRead", plugin.events.get(0).getString("kind"));
        assertEquals("alert-1", plugin.events.get(0).getJSObject("value").getString("id"));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    private static final class RecordingPlugin extends XChainWatchPlugin {
        final List<JSObject> events = new ArrayList<>();

        RecordingPlugin(boolean available, WearTransport transport, LinkProbe probe,
                java.io.File cache) {
            super(available, transport, probe, cache);
        }

        @Override
        void publishIntent(JSObject event) {
            events.add(event);
        }
    }

    private static final class RecordingBackend implements WearTransport.Backend {
        private final String node;
        final List<String> sends = new ArrayList<>();
        final List<String> states = new ArrayList<>();
        final List<String> payloads = new ArrayList<>();
        Uri file;

        RecordingBackend(String node) {
            this.node = node;
        }

        @Override
        public void nearbyNode(Consumer<String> result) {
            result.accept(node);
        }

        @Override
        public void sendMessage(String node, String path, byte[] payload) {
            sends.add("message:" + path);
            payloads.add(new String(payload, StandardCharsets.UTF_8));
        }

        @Override
        public void sendChannel(String node, String path, byte[] payload) {
            sends.add("channel:" + path);
            payloads.add(new String(payload, StandardCharsets.UTF_8));
        }

        @Override
        public void sendFile(String node, String path, Uri sentFile) {
            sends.add("file:" + path);
            file = sentFile;
        }

        @Override
        public void putState(String path, boolean enabled, long builtAt) {
            states.add(path + ":" + enabled + ":" + builtAt);
        }
    }
}
