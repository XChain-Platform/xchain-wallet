// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.watch;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class WatchAcceptanceCases {
    public static final List<String> CASES = Collections.unmodifiableList(
            Arrays.asList("balances", "alerts", "privacy"));

    private WatchAcceptanceCases() {
    }

    public static final class Send {
        public final String kind;
        public final String asset;

        public Send(String kind, String asset) {
            this.kind = kind;
            this.asset = asset;
        }
    }

    public static List<Send> fixtureSends(String caseName) {
        if (caseName == null) {
            throw new IllegalArgumentException("Unknown watch acceptance case: null");
        }

        List<Send> sends = new ArrayList<>();
        if ("balances".equals(caseName)) {
            sends.add(new Send("snapshot", "snapshot-rows50.json"));
            sends.add(new Send("detail", "detail-native.json"));
            sends.add(new Send("detail", "detail-cached.json"));
        } else if ("privacy".equals(caseName)) {
            sends.add(new Send("snapshot", "snapshot-hidden.json"));
            sends.add(new Send("snapshot", "snapshot-disabled.json"));
        } else if (!"alerts".equals(caseName)) {
            throw new IllegalArgumentException("Unknown watch acceptance case: " + caseName);
        }
        return Collections.unmodifiableList(sends);
    }
}
