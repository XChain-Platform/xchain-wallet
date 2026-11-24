/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;

public final class CallbackResolve {

    public interface Lookup {
        InetAddress[] lookup(String host) throws UnknownHostException;
    }

    public static final Lookup SYSTEM = InetAddress::getAllByName;

    private CallbackResolve() {}

    public static final class Result {
        public final String reason;
        public final InetAddress address;

        private Result(String reason, InetAddress address) {
            this.reason = reason;
            this.address = address;
        }
    }

    public static Result check(String host, boolean developerMode, Lookup lookup) {
        if (host == null || isBlank(host) || lookup == null) {
            return new Result("RESOLVE_FAILED", null);
        }

        String lookupHost = host;
        if (host.length() >= 2 && host.charAt(0) == '[' && host.charAt(host.length() - 1) == ']') {
            lookupHost = host.substring(1, host.length() - 1);
        }

        InetAddress[] addresses;
        try {
            addresses = lookup.lookup(lookupHost);
        } catch (UnknownHostException | RuntimeException failure) {
            return new Result("RESOLVE_FAILED", null);
        }
        if (addresses == null || addresses.length == 0) {
            return new Result("RESOLVE_FAILED", null);
        }

        List<byte[]> addressBytes = new ArrayList<>(addresses.length);
        for (InetAddress address : addresses) {
            addressBytes.add(address == null ? null : address.getAddress());
        }
        if (CallbackAddressRule.refusesAny(addressBytes, developerMode)) {
            return new Result("REFUSED_ADDRESS", null);
        }
        return new Result(null, addresses[0]);
    }

    private static boolean isBlank(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (!Character.isWhitespace(value.charAt(index))) return false;
        }
        return true;
    }
}
