/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;

public final class WatchMessageRouter implements
        MessageClient.OnMessageReceivedListener,
        CapabilityClient.OnCapabilityChangedListener {

    public interface Listener {
        void onIntent(String kind, byte[] payload);
        void onWatchNearby();
    }

    interface Registration {
        void add(MessageClient.OnMessageReceivedListener messages,
                CapabilityClient.OnCapabilityChangedListener capabilities);
        void remove(MessageClient.OnMessageReceivedListener messages,
                CapabilityClient.OnCapabilityChangedListener capabilities);
    }

    private static final String CAPABILITY = "xchain_wear";
    private final Registration registration;
    private final Listener listener;
    private boolean started;

    public WatchMessageRouter(MessageClient messages, CapabilityClient capabilities, Listener listener) {
        this(new Registration() {
            @Override
            public void add(MessageClient.OnMessageReceivedListener messageListener,
                    CapabilityClient.OnCapabilityChangedListener capabilityListener) {
                messages.addListener(messageListener);
                capabilities.addListener(capabilityListener, CAPABILITY);
            }

            @Override
            public void remove(MessageClient.OnMessageReceivedListener messageListener,
                    CapabilityClient.OnCapabilityChangedListener capabilityListener) {
                messages.removeListener(messageListener);
                capabilities.removeListener(capabilityListener, CAPABILITY);
            }
        }, listener);
    }

    WatchMessageRouter(Registration registration, Listener listener) {
        this.registration = registration;
        this.listener = listener;
    }

    public void start() {
        if (!started) {
            registration.add(this, this);
            started = true;
        }
    }

    public void stop() {
        if (started) {
            registration.remove(this, this);
            started = false;
        }
    }

    @Override
    public void onMessageReceived(MessageEvent event) {
        String kind = WearPaths.intentKind(event.getPath());
        if (kind != null) {
            listener.onIntent(kind, event.getData());
        }
    }

    @Override
    public void onCapabilityChanged(CapabilityInfo capability) {
        if (CAPABILITY.equals(capability.getName())
                && capability.getNodes().stream().anyMatch(node -> node.isNearby())) {
            listener.onWatchNearby();
        }
    }
}
