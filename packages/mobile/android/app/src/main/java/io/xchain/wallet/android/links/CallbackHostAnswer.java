/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;

public final class CallbackHostAnswer {

    private static final String FAILURE_MESSAGE = "Callback host lookup failed";

    private CallbackHostAnswer() {}

    public static List<String> addresses(String host, CallbackResolve.Lookup lookup)
            throws IOException {
        if (host == null || isBlank(host) || lookup == null) {
            throw failure();
        }

        String lookupHost = host;
        if (host.length() >= 2 && host.charAt(0) == '[' && host.charAt(host.length() - 1) == ']') {
            lookupHost = host.substring(1, host.length() - 1);
        }

        InetAddress[] answers;
        try {
            answers = lookup.lookup(lookupHost);
        } catch (UnknownHostException | RuntimeException exception) {
            throw failure();
        }
        if (answers == null || answers.length == 0) {
            throw failure();
        }

        List<String> result = new ArrayList<>(answers.length);
        for (InetAddress answer : answers) {
            if (answer == null) {
                throw failure();
            }
            byte[] bytes = answer.getAddress();
            if (bytes == null || (bytes.length != 4 && bytes.length != 16)) {
                throw failure();
            }
            result.add(bytes.length == 4 ? ipv4(bytes) : ipv6(bytes));
        }
        return result;
    }

    private static String ipv4(byte[] bytes) {
        return (bytes[0] & 0xff) + "."
                + (bytes[1] & 0xff) + "."
                + (bytes[2] & 0xff) + "."
                + (bytes[3] & 0xff);
    }

    private static String ipv6(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < bytes.length; index += 2) {
            if (index != 0) result.append(':');
            int word = ((bytes[index] & 0xff) << 8) | (bytes[index + 1] & 0xff);
            result.append(Integer.toHexString(word));
        }
        return result.toString();
    }

    private static boolean isBlank(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (!Character.isWhitespace(value.charAt(index))) return false;
        }
        return true;
    }

    private static IOException failure() {
        return new IOException(FAILURE_MESSAGE);
    }
}
