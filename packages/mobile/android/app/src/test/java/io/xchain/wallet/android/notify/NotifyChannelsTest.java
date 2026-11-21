/*
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class NotifyChannelsTest {

    private static final List<String> EXPECTED_FAMILIES = Arrays.asList(
            "txConfirmations",
            "incomingReceipts",
            "incomingPending",
            "messages",
            "governancePolls",
            "deadlines",
            "dispenserEscrow",
            "dispenserFills",
            "orderFills",
            "priceAlerts"
    );

    @Test
    public void mapsEverySoundFamilyToItsChannelId() {
        assertEquals(EXPECTED_FAMILIES, NotifyChannels.FAMILIES);
        for (String family : EXPECTED_FAMILIES) {
            assertTrue(NotifyChannels.isFamily(family));
            assertEquals("xc_notify_" + family, NotifyChannels.channelId(family));
        }
    }

    @Test
    public void rejectsContractFamiliesWithoutSoundChannels() {
        assertFalse(NotifyChannels.isFamily("request"));
        assertNull(NotifyChannels.channelId("request"));
        assertFalse(NotifyChannels.isFamily("paydue"));
        assertNull(NotifyChannels.channelId("paydue"));
    }

    @Test
    public void rejectsCaseVariantsEmptyStringsAndNull() {
        assertFalse(NotifyChannels.isFamily("TxConfirmations"));
        assertNull(NotifyChannels.channelId("TxConfirmations"));
        assertFalse(NotifyChannels.isFamily(""));
        assertNull(NotifyChannels.channelId(""));
        assertFalse(NotifyChannels.isFamily(null));
        assertNull(NotifyChannels.channelId(null));
    }

    @Test
    public void familiesCannotBeExtended() {
        try {
            NotifyChannels.FAMILIES.add("request");
            fail("FAMILIES accepted add");
        } catch (UnsupportedOperationException expected) {
            assertEquals(EXPECTED_FAMILIES, NotifyChannels.FAMILIES);
        }
    }
}
