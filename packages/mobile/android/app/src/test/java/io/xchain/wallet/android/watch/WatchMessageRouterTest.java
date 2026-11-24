/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import android.content.Context;
import android.net.Uri;
import com.google.android.gms.common.api.GoogleApi;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import java.lang.reflect.Proxy;
import java.util.Collections;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public class WatchMessageRouterTest {

    @Test
    public void registersOnlyWhileStarted() {
        Context context = RuntimeEnvironment.getApplication();
        RecordingMessageClient messages = new RecordingMessageClient(context);
        RecordingCapabilityClient capabilities = new RecordingCapabilityClient(context);
        WatchMessageRouter router = new WatchMessageRouter(
                messages, capabilities, new RecordingListener());

        router.start();
        router.start();
        assertEquals(1, messages.adds);
        assertSame(router, messages.listener);
        assertEquals(1, capabilities.adds);
        assertSame(router, capabilities.listener);
        assertEquals("xchain_wear", capabilities.name);

        router.stop();
        router.stop();
        assertEquals(1, messages.removes);
        assertEquals(1, capabilities.removes);
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
        @Override
        public void add(MessageClient.OnMessageReceivedListener messageListener,
                CapabilityClient.OnCapabilityChangedListener capabilityListener) {
        }

        @Override
        public void remove(MessageClient.OnMessageReceivedListener messageListener,
                CapabilityClient.OnCapabilityChangedListener capabilityListener) {
        }
    }

    private static final class RecordingMessageClient extends MessageClient {
        int adds;
        int removes;
        OnMessageReceivedListener listener;

        RecordingMessageClient(Context context) {
            super(context, GoogleApi.Settings.DEFAULT_SETTINGS);
        }

        @Override
        public Task<Integer> sendMessage(String nodeId, String path, byte[] data) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<byte[]> sendRequest(String nodeId, String path, byte[] data) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Void> addListener(OnMessageReceivedListener messageListener) {
            adds += 1;
            listener = messageListener;
            return null;
        }

        @Override
        public Task<Void> addListener(
                OnMessageReceivedListener messageListener, Uri uri, int filterType) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Boolean> removeListener(OnMessageReceivedListener messageListener) {
            removes += 1;
            assertSame(listener, messageListener);
            return null;
        }

        @Override
        public Task<Void> addRpcService(RpcService service, String path) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Void> addRpcService(RpcService service, String path, String nodeId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Boolean> removeRpcService(RpcService service) {
            throw new UnsupportedOperationException();
        }
    }

    private static final class RecordingCapabilityClient extends CapabilityClient {
        int adds;
        int removes;
        OnCapabilityChangedListener listener;
        String name;

        RecordingCapabilityClient(Context context) {
            super(context, GoogleApi.Settings.DEFAULT_SETTINGS);
        }

        @Override
        public Task<CapabilityInfo> getCapability(String capability, int filter) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Map<String, CapabilityInfo>> getAllCapabilities(int filter) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Void> addLocalCapability(String capability) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Void> removeLocalCapability(String capability) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Void> addListener(
                OnCapabilityChangedListener capabilityListener, String capability) {
            adds += 1;
            listener = capabilityListener;
            name = capability;
            return null;
        }

        @Override
        public Task<Void> addListener(
                OnCapabilityChangedListener capabilityListener, Uri uri, int filterType) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Task<Boolean> removeListener(
                OnCapabilityChangedListener capabilityListener, String capability) {
            removes += 1;
            assertSame(listener, capabilityListener);
            assertEquals(name, capability);
            return null;
        }

        @Override
        public Task<Boolean> removeListener(OnCapabilityChangedListener capabilityListener) {
            throw new UnsupportedOperationException();
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
