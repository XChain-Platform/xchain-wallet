/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.util.List;

public final class CallbackAddressRule {

    private CallbackAddressRule() {}

    public static boolean isRefused(byte[] address, boolean developerMode) {
        if (address == null) return true;
        if (address.length == 4) return isIpv4Refused(address, developerMode);
        if (address.length == 16) return isIpv6Refused(address, developerMode);
        return true;
    }

    public static boolean refusesAny(List<byte[]> addresses, boolean developerMode) {
        if (addresses == null || addresses.isEmpty()) return true;
        for (byte[] address : addresses) {
            if (isRefused(address, developerMode)) return true;
        }
        return false;
    }

    private static boolean isIpv4Refused(byte[] address, boolean developerMode) {
        int first = unsigned(address[0]);
        int second = unsigned(address[1]);
        int third = unsigned(address[2]);

        if (first == 0 || first == 10) return true;
        if (first == 100 && second >= 64 && second <= 127) return true;
        if (first == 127) return !developerMode;
        if (first == 169 && second == 254) return true;
        if (first == 172 && second >= 16 && second <= 31) return true;
        if (first == 192 && second == 0 && third == 0) return true;
        if (first == 192 && second == 168) return true;
        if (first == 198 && (second == 18 || second == 19)) return true;
        return first >= 224;
    }

    private static boolean isIpv6Refused(byte[] address, boolean developerMode) {
        if (isAllZero(address)) return true;
        if (isLoopback(address)) return !developerMode;
        if (hasZeroPrefix(address, 12)) return true;
        if (hasZeroPrefix(address, 10)
                && unsigned(address[10]) == 255
                && unsigned(address[11]) == 255) return true;

        int first = unsigned(address[0]);
        int second = unsigned(address[1]);
        if ((first & 0xfe) == 0xfc) return true;
        if (first == 0xfe && (second & 0xc0) == 0x80) return true;
        return first == 0xff;
    }

    private static boolean isAllZero(byte[] address) {
        return hasZeroPrefix(address, address.length);
    }

    private static boolean isLoopback(byte[] address) {
        return hasZeroPrefix(address, 15) && unsigned(address[15]) == 1;
    }

    private static boolean hasZeroPrefix(byte[] address, int length) {
        for (int index = 0; index < length; index++) {
            if (address[index] != 0) return false;
        }
        return true;
    }

    private static int unsigned(byte value) {
        return value & 0xff;
    }
}
