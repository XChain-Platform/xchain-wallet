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

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class NotifyChannels {

    public static final List<String> FAMILIES = Collections.unmodifiableList(Arrays.asList(
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
    ));

    private NotifyChannels() {}

    public static boolean isFamily(String family) {
        return FAMILIES.contains(family);
    }

    public static String channelId(String family) {
        return isFamily(family) ? "xc_notify_" + family : null;
    }
}
