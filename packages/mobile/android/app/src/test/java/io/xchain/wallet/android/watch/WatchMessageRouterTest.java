/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import java.lang.reflect.Proxy;
import java.util.Collections;
import org.junit.Test;

public class WatchMessageRouterTest {

    @Test
    public void registersOnlyWhileStarted() {
        FakeRegistration registration = new FakeRegistration();
        WatchMessageRouter router = new WatchMessageRouter(registration, new RecordingListener());

        router.start();
        router.start();
        assertEquals(1, registration.adds);
        assertSame(router, registration.messages);
        assertSame(router, registration.capabilities);

        router.stop();
        router.stop();
        assertEquals(1, registration.removes);
    }

    @Test
    public void forwardsKnownIntentKindAndPayload() {
        RecordingListener listener = new RecordingListener();
        WatchMessageRouter router = new WatchMessageRouter(new FakeRegistration(), listener);
        byte[] payload = new byte[] { 1, 2, 3 };

        router.onMessageReceived(message("/xc/intent/detailRequest", payload));

        assertEquals("detailRequest", listener.kind);
        assertArrayEquals(payload, listener.payload);
    }

    @Test
    public void ignoresNonIntentMessages() {
        RecordingListener listener = new RecordingListener();
        WatchMessageRouter router = new WatchMessageRouter(new FakeRegistration(), listener);

        router.onMessageReceived(message("/xc/snapshot", new byte[] { 1 }));

        assertEquals(0, listener.intents);
    }

    @Test
    public void reportsOnlyNearbyWatchCapability() {
        RecordingListener listener = new RecordingListener();
        WatchMessageRouter router = new WatchMessageRouter(new FakeRegistration(), listener);

        router.onCapabilityChanged(capability("other", true));
        router.onCapabilityChanged(capability("xchain_wear", false));
        router.onCapabilityChanged(capability("xchain_wear", true));

        assertEquals(1, listener.nearbyArrivals);
    }

    private static MessageEvent message(String path, byte[] payload) {
        return proxy(MessageEvent.class, (name) -> {
            if ("getPath".equals(name)) return path;
            if ("getData".equals(name)) return payload;
            return null;
        });
    }

    private static CapabilityInfo capability(String name, boolean nearby) {
        Node node = proxy(Node.class, (method) -> "isNearby".equals(method) && nearby);
        return proxy(CapabilityInfo.class, (method) -> {
            if ("getName".equals(method)) return name;
            if ("getNodes".equals(method)) return Collections.singleton(node);
            return null;
        });
    }

    private interface Answer {
        Object value(String method);
    }

    private static <T> T proxy(Class<T> type, Answer answer) {
        return type.cast(Proxy.newProxyInstance(
                type.getClassLoader(), new Class<?>[] { type },
                (target, method, arguments) -> answer.value(method.getName())));
    }

    private static final class FakeRegistration implements WatchMessageRouter.Registration {
        int adds;
        int removes;
        MessageClient.OnMessageReceivedListener messages;
        CapabilityClient.OnCapabilityChangedListener capabilities;

        @Override
        public void add(MessageClient.OnMessageReceivedListener messageListener,
                CapabilityClient.OnCapabilityChangedListener capabilityListener) {
            adds += 1;
            messages = messageListener;
            capabilities = capabilityListener;
        }

        @Override
        public void remove(MessageClient.OnMessageReceivedListener messageListener,
                CapabilityClient.OnCapabilityChangedListener capabilityListener) {
            removes += 1;
            assertSame(messages, messageListener);
            assertSame(capabilities, capabilityListener);
        }
    }

    private static final class RecordingListener implements WatchMessageRouter.Listener {
        int intents;
        int nearbyArrivals;
        String kind;
        byte[] payload;

        @Override
        public void onIntent(String intentKind, byte[] intentPayload) {
            intents += 1;
            kind = intentKind;
            payload = intentPayload;
        }

        @Override
        public void onWatchNearby() {
            nearbyArrivals += 1;
        }
    }
}
