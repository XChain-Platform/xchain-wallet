/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackPostRequest;

import java.util.Arrays;

public final class CallbackPostRequestCheck {

    private static final String HTTPS_HREF = "https://example.com/cb";
    private static final String BODY = "{\"ok\":true}";
    private static int passed;

    private CallbackPostRequestCheck() {}

    public static void main(String[] args) {
        accepted("public IPv4", request(HTTPS_HREF, "8.8.8.8", BODY, 10000,
                "manual", "omit", false), HTTPS_HREF, BODY, v4(8, 8, 8, 8));
        accepted("public IPv6", request(HTTPS_HREF, "2001:4860:4860::8888", BODY, 10000,
                "manual", "omit", false), HTTPS_HREF, BODY,
                v6(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888));
        accepted("bracketed public IPv6", request(HTTPS_HREF, "[2001:4860:4860::8888]", BODY,
                10000, "manual", "omit", false), HTTPS_HREF, BODY,
                v6(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888));

        refused("null address", request(HTTPS_HREF, null, BODY, 10000, "manual", "omit", false));
        refused("hostname", request(HTTPS_HREF, "example.com", BODY, 10000,
                "manual", "omit", false));
        refused("short IPv4", request(HTTPS_HREF, "1.2.3", BODY, 10000,
                "manual", "omit", false));
        refused("long IPv4", request(HTTPS_HREF, "1.2.3.4.5", BODY, 10000,
                "manual", "omit", false));
        refused("out-of-range IPv4", request(HTTPS_HREF, "256.1.1.1", BODY, 10000,
                "manual", "omit", false));
        refused("IPv4 suffix", request(HTTPS_HREF, "1.2.3.4x", BODY, 10000,
                "manual", "omit", false));
        refused("non-hex IPv6", request(HTTPS_HREF, "g::1", BODY, 10000,
                "manual", "omit", false));
        refused("scoped IPv6", request(HTTPS_HREF, "fe80::1%en0", BODY, 10000,
                "manual", "omit", false));
        refused("private IPv4", request(HTTPS_HREF, "10.0.0.1", BODY, 10000,
                "manual", "omit", false));
        refused("mapped IPv4", request(HTTPS_HREF, "::ffff:8.8.8.8", BODY, 10000,
                "manual", "omit", false));
        refused("IPv6 loopback", request(HTTPS_HREF, "::1", BODY, 10000,
                "manual", "omit", false));

        refused("localhost without Developer Mode", request("http://localhost:8080/cb",
                "127.0.0.1", BODY, 10000, "manual", "omit", false));
        accepted("localhost with Developer Mode", request("http://localhost:8080/cb",
                "127.0.0.1", BODY, 10000, "manual", "omit", true),
                "http://localhost:8080/cb", BODY, v4(127, 0, 0, 1));

        refused("redirect follow", request(HTTPS_HREF, "8.8.8.8", BODY, 10000,
                "follow", "omit", false));
        refused("credentials include", request(HTTPS_HREF, "8.8.8.8", BODY, 10000,
                "manual", "include", false));
        refused("zero timeout", request(HTTPS_HREF, "8.8.8.8", BODY, 0,
                "manual", "omit", false));
        refused("negative timeout", request(HTTPS_HREF, "8.8.8.8", BODY, -1,
                "manual", "omit", false));
        refused("NaN timeout", request(HTTPS_HREF, "8.8.8.8", BODY, Double.NaN,
                "manual", "omit", false));
        refused("public HTTP", request("http://example.com/cb", "8.8.8.8", BODY, 10000,
                "manual", "omit", false));
        refused("fragment", request("https://example.com/cb#x", "8.8.8.8", BODY, 10000,
                "manual", "omit", false));
        refused("oversized body", request(HTTPS_HREF, "8.8.8.8", repeat('a', 10241), 10000,
                "manual", "omit", false));
        refused("null href", request(null, "8.8.8.8", BODY, 10000,
                "manual", "omit", false));
        refused("null body", request(HTTPS_HREF, "8.8.8.8", null, 10000,
                "manual", "omit", false));

        System.out.println("CallbackPostRequestCheck: " + passed + " passed, 0 failed");
    }

    private static CallbackPostRequest request(
            String href,
            String address,
            String body,
            double timeoutMs,
            String redirect,
            String credentials,
            boolean developerMode) {
        return CallbackPostRequest.check(
                href, address, body, timeoutMs, redirect, credentials, developerMode);
    }

    private static void accepted(
            String name,
            CallbackPostRequest request,
            String expectedHref,
            String expectedBody,
            byte[] expectedAddress) {
        check(name + " request", request != null);
        check(name + " href", expectedHref.equals(request.href));
        check(name + " body", expectedBody.equals(request.body));
        check(name + " address", Arrays.equals(expectedAddress, request.address.getAddress()));
    }

    private static void refused(String name, CallbackPostRequest request) {
        check(name, request == null);
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
        passed++;
    }

    private static byte[] v4(int first, int second, int third, int fourth) {
        return new byte[] {(byte) first, (byte) second, (byte) third, (byte) fourth};
    }

    private static byte[] v6(int... hextets) {
        if (hextets.length != 8) throw new IllegalArgumentException("IPv6 requires 8 hextets");
        byte[] address = new byte[16];
        for (int index = 0; index < hextets.length; index++) {
            address[index * 2] = (byte) (hextets[index] >>> 8);
            address[index * 2 + 1] = (byte) hextets[index];
        }
        return address;
    }

    private static String repeat(char value, int count) {
        char[] values = new char[count];
        Arrays.fill(values, value);
        return new String(values);
    }
}
