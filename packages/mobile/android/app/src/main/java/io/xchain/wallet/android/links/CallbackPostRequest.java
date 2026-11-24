/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.net.InetAddress;
import java.net.UnknownHostException;

public final class CallbackPostRequest {

    public final String href;
    public final String body;
    public final InetAddress address;

    private CallbackPostRequest(String href, String body, InetAddress address) {
        this.href = href;
        this.body = body;
        this.address = address;
    }

    public static CallbackPostRequest check(
            String href,
            String address,
            String body,
            double timeoutMs,
            String redirect,
            String credentials,
            boolean developerMode) {
        if (href == null || body == null) return null;
        if (!Double.isFinite(timeoutMs) || timeoutMs <= 0) return null;
        if (!"manual".equals(redirect) || !"omit".equals(credentials)) return null;
        if (!CallbackPostRule.acceptsTarget(href, developerMode)
                || !CallbackPostRule.bodyFits(body)) return null;

        String literal = stripBrackets(address);
        if (literal == null) return null;

        boolean ipv6 = literal.indexOf(':') >= 0;
        if (ipv6 ? !isIpv6Literal(literal) : !isIpv4Literal(literal)) return null;

        InetAddress parsed;
        try {
            parsed = InetAddress.getByName(literal);
        } catch (UnknownHostException | RuntimeException exception) {
            return null;
        }

        if (ipv6 && parsed.getAddress().length == 4) return null;
        if (CallbackAddressRule.isRefused(parsed.getAddress(), developerMode)) return null;
        return new CallbackPostRequest(href, body, parsed);
    }

    private static String stripBrackets(String address) {
        if (address == null) return null;
        if (address.startsWith("[") && address.endsWith("]")) {
            return address.substring(1, address.length() - 1);
        }
        return address;
    }

    private static boolean isIpv4Literal(String literal) {
        String[] parts = literal.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (part.length() < 1 || part.length() > 3) return false;
            int value = 0;
            for (int index = 0; index < part.length(); index++) {
                char character = part.charAt(index);
                if (character < '0' || character > '9') return false;
                value = value * 10 + character - '0';
            }
            if (value > 255) return false;
        }
        return true;
    }

    private static boolean isIpv6Literal(String literal) {
        for (int index = 0; index < literal.length(); index++) {
            char character = literal.charAt(index);
            if ((character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f')
                    || (character >= 'A' && character <= 'F')
                    || character == ':'
                    || character == '.') continue;
            return false;
        }
        return true;
    }
}
