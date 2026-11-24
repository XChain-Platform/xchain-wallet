/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackResolve;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;

public final class CallbackResolveCheck {

    private static int passed;

    private CallbackResolveCheck() {}

    public static void main(String[] args) throws Exception {
        success("public answer", result("public", false, answers(v4("public", 8, 8, 8, 8))),
                v4Bytes(8, 8, 8, 8));

        refused("mixed public and private answer", result("mixed", false, answers(
                v4("public", 8, 8, 8, 8), v4("private", 10, 0, 0, 1))));
        refused("loopback answer", result("loopback", false, answers(
                v4("loopback", 127, 0, 0, 1))));
        success("Developer Mode loopback answer", result("loopback", true, answers(
                v4("loopback", 127, 0, 0, 1))), v4Bytes(127, 0, 0, 1));

        failed("UnknownHostException", CallbackResolve.check("missing", false, host -> {
            throw new UnknownHostException(host);
        }));
        failed("SecurityException", CallbackResolve.check("blocked", false, host -> {
            throw new SecurityException(host);
        }));
        failed("null answer", result("null", false, host -> null));
        failed("empty answer", result("empty", false, host -> new InetAddress[0]));

        CountingLookup invalidLookup = new CountingLookup();
        failed("null host", CallbackResolve.check(null, false, invalidLookup));
        failed("empty host", CallbackResolve.check("", false, invalidLookup));
        failed("blank host", CallbackResolve.check("  \t", false, invalidLookup));
        failed("null lookup", CallbackResolve.check("example.com", false, null));
        check("invalid input lookup not called", invalidLookup.calls == 0);

        RecordingLookup bracketLookup = new RecordingLookup(
                v6("public-v6", 0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888));
        success("bracketed IPv6", result("[2001:4860:4860::8888]", false, bracketLookup),
                v6Bytes(0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888));
        check("bracketed IPv6 lookup host",
                "2001:4860:4860::8888".equals(bracketLookup.host));

        success("SYSTEM public literal", CallbackResolve.check("8.8.8.8", false,
                CallbackResolve.SYSTEM), v4Bytes(8, 8, 8, 8));
        refused("SYSTEM localhost", CallbackResolve.check("localhost", false,
                CallbackResolve.SYSTEM));

        System.out.println("CallbackResolveCheck: " + passed + " passed, 0 failed");
    }

    private static CallbackResolve.Result result(
            String host, boolean developerMode, CallbackResolve.Lookup lookup) {
        return CallbackResolve.check(host, developerMode, lookup);
    }

    private static CallbackResolve.Lookup answers(InetAddress... addresses) {
        return host -> addresses;
    }

    private static InetAddress v4(String host, int first, int second, int third, int fourth)
            throws UnknownHostException {
        return InetAddress.getByAddress(host, v4Bytes(first, second, third, fourth));
    }

    private static byte[] v4Bytes(int first, int second, int third, int fourth) {
        return new byte[] {(byte) first, (byte) second, (byte) third, (byte) fourth};
    }

    private static InetAddress v6(String host, int... hextets) throws UnknownHostException {
        return InetAddress.getByAddress(host, v6Bytes(hextets));
    }

    private static byte[] v6Bytes(int... hextets) {
        if (hextets.length != 8) throw new IllegalArgumentException("IPv6 requires 8 hextets");
        byte[] address = new byte[16];
        for (int index = 0; index < hextets.length; index++) {
            address[index * 2] = (byte) (hextets[index] >>> 8);
            address[index * 2 + 1] = (byte) hextets[index];
        }
        return address;
    }

    private static void success(String name, CallbackResolve.Result result, byte[] expected) {
        check(name + " reason", result.reason == null);
        check(name + " address", result.address != null
                && Arrays.equals(expected, result.address.getAddress()));
    }

    private static void refused(String name, CallbackResolve.Result result) {
        check(name + " reason", "REFUSED_ADDRESS".equals(result.reason));
        check(name + " address", result.address == null);
    }

    private static void failed(String name, CallbackResolve.Result result) {
        check(name + " reason", "RESOLVE_FAILED".equals(result.reason));
        check(name + " address", result.address == null);
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
        passed++;
    }

    private static final class CountingLookup implements CallbackResolve.Lookup {
        private int calls;

        @Override
        public InetAddress[] lookup(String host) {
            calls++;
            return new InetAddress[0];
        }
    }

    private static final class RecordingLookup implements CallbackResolve.Lookup {
        private final InetAddress[] addresses;
        private String host;

        private RecordingLookup(InetAddress... addresses) {
            this.addresses = addresses;
        }

        @Override
        public InetAddress[] lookup(String host) {
            this.host = host;
            return addresses;
        }
    }
}
