// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui;

import java.util.Base64;

public final class QrModules {
    private QrModules() {}

    public static boolean[] unpack(int size, String bits) {
        if (size < 1 || bits == null) return null;

        byte[] packed;
        try {
            packed = Base64.getDecoder().decode(bits);
        } catch (IllegalArgumentException exception) {
            return null;
        }

        long moduleCount = (long) size * size;
        long expectedByteCount = (moduleCount + 7) / 8;
        if (moduleCount > Integer.MAX_VALUE || packed.length != expectedByteCount) return null;

        boolean[] modules = new boolean[(int) moduleCount];
        for (int index = 0; index < modules.length; index += 1) {
            modules[index] = ((packed[index >> 3] >> (7 - (index & 7))) & 1) != 0;
        }
        return modules;
    }
}
