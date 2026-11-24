/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackPinnedTarget;

import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SNIServerName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPinnedTargetCheck {

    private static int passed;

    private CallbackPinnedTargetCheck() {}

    public static void main(String[] args) {
        InetAddress ipv4 = address(8, 8, 8, 8);
        InetAddress otherIpv4 = address(1, 1, 1, 1);
        InetAddress ipv6 = address(
                0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88
        );

        check("pins IPv4 target", () -> "https://8.8.8.8/cb?x=1".equals(
                CallbackPinnedTarget.pinnedUrl("https://example.com/cb?x=1", ipv4).toString()
        ));
        check("pins IPv6 target", () -> (
                "https://[2001:4860:4860:0:0:0:0:8888]:8443/a/b%20c"
        ).equals(CallbackPinnedTarget.pinnedUrl(
                "https://example.com:8443/a/b%20c",
                ipv6
        ).toString()));
        check("accepts matching IP literal", () -> "https://8.8.8.8/cb".equals(
                CallbackPinnedTarget.pinnedUrl("https://8.8.8.8/cb", ipv4).toString()
        ));
        check("accepts matching IPv6 literal", () -> (
                "https://[2001:4860:4860:0:0:0:0:8888]/cb"
        ).equals(CallbackPinnedTarget.pinnedUrl(
                "https://[2001:4860:4860::8888]/cb",
                ipv6
        ).toString()));
        check("preserves raw path and query", () -> (
                "https://8.8.8.8/%2f%2F/a%20b?x=%2b%2B&x=1"
        ).equals(CallbackPinnedTarget.pinnedUrl(
                "HTTPS://Example.COM/%2f%2F/a%20b?x=%2b%2B&x=1",
                ipv4
        ).toString()));
        refuses("refuses mismatched IP literal", () ->
                CallbackPinnedTarget.pinnedUrl("https://8.8.8.8/cb", otherIpv4));
        refuses("refuses mismatched IPv6 literal", () ->
                CallbackPinnedTarget.pinnedUrl("https://[2001:db8::1]/cb", ipv6));
        refuses("refuses HTTP", () ->
                CallbackPinnedTarget.pinnedUrl("http://example.com/cb", ipv4));
        refuses("refuses userinfo", () ->
                CallbackPinnedTarget.pinnedUrl("https://u:p@example.com/cb", ipv4));
        refuses("refuses fragment", () ->
                CallbackPinnedTarget.pinnedUrl("https://example.com/cb#x", ipv4));
        refuses("refuses missing host", () ->
                CallbackPinnedTarget.pinnedUrl("https:///cb", ipv4));
        refuses("refuses null href", () -> CallbackPinnedTarget.pinnedUrl(null, ipv4));
        refuses("refuses null address", () ->
                CallbackPinnedTarget.pinnedUrl("https://example.com/cb", null));

        check("host header omits implicit port", () -> "example.com".equals(
                CallbackPinnedTarget.hostHeader("https://example.com/cb")
        ));
        check("host header omits explicit 443", () -> "example.com".equals(
                CallbackPinnedTarget.hostHeader("https://example.com:443/cb")
        ));
        check("host header keeps non-default port", () -> "example.com:8443".equals(
                CallbackPinnedTarget.hostHeader("https://example.com:8443/cb")
        ));
        check("host header preserves host spelling", () -> "Example.COM:8443".equals(
                CallbackPinnedTarget.hostHeader("https://Example.COM:8443/cb")
        ));
        check("host header excludes userinfo", () -> "example.com:8443".equals(
                CallbackPinnedTarget.hostHeader("https://u:p@example.com:8443/cb")
        ));

        check("server name lowercases DNS host", () -> "example.com".equals(
                CallbackPinnedTarget.serverName("https://Example.COM/cb")
        ));
        check("server name excludes userinfo", () -> "example.com".equals(
                CallbackPinnedTarget.serverName("https://u:p@Example.COM/cb")
        ));
        check("server name omits IPv4 literal", () ->
                CallbackPinnedTarget.serverName("https://8.8.8.8/cb") == null);
        check("server name omits IPv6 literal", () ->
                CallbackPinnedTarget.serverName("https://[2001:db8::1]/cb") == null);

        SSLSocketFactory base = defaultFactory();
        check("null server name preserves factory", () ->
                CallbackPinnedTarget.withServerName(base, null) == base);
        SSLSocketFactory wrapped = CallbackPinnedTarget.withServerName(base, "example.com");
        check("wrapper preserves default cipher suites", () -> Arrays.equals(
                base.getDefaultCipherSuites(),
                wrapped.getDefaultCipherSuites()
        ));
        check("wrapper preserves supported cipher suites", () -> Arrays.equals(
                base.getSupportedCipherSuites(),
                wrapped.getSupportedCipherSuites()
        ));
        check("wrapper sets one server name", () -> {
            try (SSLSocket socket = (SSLSocket) wrapped.createSocket()) {
                List<SNIServerName> names = socket.getSSLParameters().getServerNames();
                return names != null
                        && names.size() == 1
                        && names.get(0).equals(new SNIHostName("example.com"));
            }
        });

        RecordingVerifier recording = new RecordingVerifier(true);
        HostnameVerifier verifier = CallbackPinnedTarget.verifierFor("example.com", recording);
        check("verifier forwards real host and true", () ->
                verifier.verify("8.8.8.8", null)
                        && "example.com".equals(recording.host)
                        && recording.session == null);
        recording.answer = false;
        check("verifier forwards false", () -> !verifier.verify("8.8.8.8", null));

        System.out.println("CallbackPinnedTargetCheck: " + passed + " passed, 0 failed");
    }

    private static InetAddress address(int... octets) {
        byte[] bytes = new byte[octets.length];
        for (int index = 0; index < octets.length; index++) bytes[index] = (byte) octets[index];
        try {
            return InetAddress.getByAddress(bytes);
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static SSLSocketFactory defaultFactory() {
        try {
            return SSLContext.getDefault().getSocketFactory();
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static void refuses(String name, CheckedAction action) {
        check(name, () -> {
            try {
                action.run();
                return false;
            } catch (IllegalArgumentException expected) {
                return true;
            }
        });
    }

    private static void check(String name, CheckedCheck check) {
        try {
            if (!check.run()) throw new AssertionError("condition was false");
            passed++;
        } catch (Throwable error) {
            System.err.println(name + ": " + error);
            System.exit(1);
        }
    }

    private interface CheckedCheck {
        boolean run() throws Exception;
    }

    private interface CheckedAction {
        void run() throws Exception;
    }

    private static final class RecordingVerifier implements HostnameVerifier {
        private boolean answer;
        private String host;
        private SSLSession session;

        private RecordingVerifier(boolean answer) {
            this.answer = answer;
        }

        @Override
        public boolean verify(String host, SSLSession session) {
            this.host = host;
            this.session = session;
            return answer;
        }
    }
}
