/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackHostAnswer;
import io.xchain.wallet.android.links.CallbackResolve;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;

public final class CallbackHostAnswerCheck {

    private static final String FAILURE_MESSAGE = "Callback host lookup failed";
    private static int passed;

    private CallbackHostAnswerCheck() {}

    public static void main(String[] args) throws Exception {
        answers("ordered public answers",
                CallbackHostAnswer.addresses("public", host -> new InetAddress[] {
                        v4(host, 8, 8, 8, 8), v4(host, 1, 1, 1, 1)
                }),
                "8.8.8.8", "1.1.1.1");
        answers("private answer",
                CallbackHostAnswer.addresses("private", host -> new InetAddress[] {
                        v4(host, 10, 0, 0, 1)
                }),
                "10.0.0.1");
        answers("IPv6 answer", CallbackHostAnswer.addresses("public-v6", host -> new InetAddress[] {
                v6(host, 0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888)
        }), "2001:4860:4860:0:0:0:0:8888");
        answers("scoped IPv6 answer", CallbackHostAnswer.addresses("scoped-v6", host ->
                new InetAddress[] {Inet6Address.getByAddress(
                        host, v6Bytes(0xfe80, 0, 0, 0, 0, 0, 0, 1), 1)}),
                "fe80:0:0:0:0:0:0:1");

        RecordingLookup bracketLookup = new RecordingLookup(
                v6("bracketed-v6", 0x2001, 0xdb8, 0, 0, 0, 0, 0, 1));
        answers("bracketed IPv6 answer",
                CallbackHostAnswer.addresses("[2001:db8::1]", bracketLookup),
                "2001:db8:0:0:0:0:0:1");
        check("bracketed IPv6 lookup host", "2001:db8::1".equals(bracketLookup.host));
        check("bracketed IPv6 lookup count", bracketLookup.calls == 1);

        fails("UnknownHostException", () -> CallbackHostAnswer.addresses("missing", host -> {
            throw new UnknownHostException(host);
        }));
        fails("SecurityException", () -> CallbackHostAnswer.addresses("blocked", host -> {
            throw new SecurityException(host);
        }));
        fails("null answer", () -> CallbackHostAnswer.addresses("null", host -> null));
        fails("empty answer", () -> CallbackHostAnswer.addresses(
                "empty", host -> new InetAddress[0]));
        fails("null entry", () -> CallbackHostAnswer.addresses(
                "null-entry", host -> new InetAddress[] {null}));

        CountingLookup invalidLookup = new CountingLookup();
        fails("null host", () -> CallbackHostAnswer.addresses(null, invalidLookup));
        fails("empty host", () -> CallbackHostAnswer.addresses("", invalidLookup));
        fails("blank host", () -> CallbackHostAnswer.addresses("  \t", invalidLookup));
        fails("null lookup", () -> CallbackHostAnswer.addresses("example.com", null));
        check("invalid input lookup not called", invalidLookup.calls == 0);

        System.out.println("CallbackHostAnswerCheck: " + passed + " passed, 0 failed");
    }

    private static InetAddress v4(String host, int first, int second, int third, int fourth)
            throws UnknownHostException {
        return InetAddress.getByAddress(host, new byte[] {
                (byte) first, (byte) second, (byte) third, (byte) fourth
        });
    }

    private static InetAddress v6(String host, int... words) throws UnknownHostException {
        return InetAddress.getByAddress(host, v6Bytes(words));
    }

    private static byte[] v6Bytes(int... words) {
        if (words.length != 8) throw new IllegalArgumentException("IPv6 requires 8 words");
        byte[] bytes = new byte[16];
        for (int index = 0; index < words.length; index++) {
            bytes[index * 2] = (byte) (words[index] >>> 8);
            bytes[index * 2 + 1] = (byte) words[index];
        }
        return bytes;
    }

    private static void answers(String name, List<String> actual, String... expected) {
        check(name, actual.equals(Arrays.asList(expected)));
    }

    private static void fails(String name, ThrowingCall call) {
        try {
            call.run();
            check(name, false);
        } catch (IOException exception) {
            check(name, FAILURE_MESSAGE.equals(exception.getMessage()));
        } catch (Exception exception) {
            check(name, false);
        }
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
        passed++;
    }

    private interface ThrowingCall {
        void run() throws Exception;
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
        private int calls;
        private String host;

        private RecordingLookup(InetAddress... addresses) {
            this.addresses = addresses;
        }

        @Override
        public InetAddress[] lookup(String host) {
            calls++;
            this.host = host;
            return addresses;
        }
    }
}
