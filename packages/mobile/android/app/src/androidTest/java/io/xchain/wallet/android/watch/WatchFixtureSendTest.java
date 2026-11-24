/*
 * Copyright © 2025–2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class WatchFixtureSendTest {

    @Test
    public void sendsRiskEightSnapshotAndImageThroughPlugin() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        XChainWatchPlugin plugin = new XChainWatchPlugin(context);
        WearTransport transport = new WearTransport(context);
        CountDownLatch checked = new CountDownLatch(1);
        AtomicReference<String> nearbyNode = new AtomicReference<>();
        transport.nearbyNode(node -> {
            nearbyNode.set(node);
            checked.countDown();
        });

        assertTrue("Timed out checking for a nearby watch", checked.await(20, TimeUnit.SECONDS));
        Assume.assumeTrue("No nearby watch node advertises xchain_wear", nearbyNode.get() != null);

        byte[] snapshot = WatchRisk8Payload.snapshotJson(System.currentTimeMillis());
        byte[] image = WatchRisk8Payload.png(400);
        String hash = WatchRisk8Payload.sha256Hex(image);

        assertTrue(plugin.sendSnapshotJson(new String(snapshot, StandardCharsets.UTF_8)));
        assertTrue(plugin.sendImageData(hash, Base64.getEncoder().encodeToString(image)));
    }
}
