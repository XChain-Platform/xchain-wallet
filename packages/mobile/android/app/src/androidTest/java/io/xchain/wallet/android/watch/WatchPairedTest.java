// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.CapabilityInfo;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class WatchPairedTest {
    @Test
    public void nearbyConnectedNodeAdvertisesWearCapability() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        List<Node> connected = Tasks.await(
                Wearable.getNodeClient(context).getConnectedNodes(), 20, TimeUnit.SECONDS);
        CapabilityInfo capability = Tasks.await(
                Wearable.getCapabilityClient(context).getCapability(
                        "xchain_wear", CapabilityClient.FILTER_REACHABLE),
                20,
                TimeUnit.SECONDS);
        Set<Node> capable = capability.getNodes();

        boolean paired = false;
        for (Node node : connected) {
            for (Node capableNode : capable) {
                if (node.isNearby() && node.getId().equals(capableNode.getId())) {
                    paired = true;
                    break;
                }
            }
            if (paired) break;
        }
        assertTrue("No nearby connected node advertises xchain_wear", paired);
    }
}
