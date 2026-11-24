/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackPinnedOpen;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.URLConnection;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.List;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SNIServerName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLPeerUnverifiedException;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPinnedOpenCheck {

    private static int passed;

    private CallbackPinnedOpenCheck() {}

    public static void main(String[] args) {
        InetAddress ipv4 = address(8, 8, 8, 8);
        InetAddress otherIpv4 = address(1, 1, 1, 1);
        InetAddress ipv6 = address(
                0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88
        );
        SSLSocketFactory factory = defaultFactory();

        check("opens pinned IPv4 without connecting", () -> {
            RecordingHttpsConnection connection = https("https://8.8.8.8/cb?x=1");
            RecordingOpener opener = new RecordingOpener(connection);
            RecordingVerifier base = new RecordingVerifier(true);

            HttpsURLConnection answer = CallbackPinnedOpen.open(
                    "https://example.com/cb?x=1",
                    ipv4,
                    opener,
                    factory,
                    base
            );

            return answer == connection
                    && opener.calls == 1
                    && "https://8.8.8.8/cb?x=1".equals(opener.url.toString())
                    && connection.connectCalls == 0
                    && "example.com".equals(connection.getRequestProperty("Host"))
                    && serverNames(connection.getSSLSocketFactory()).equals(
                            List.of(new SNIHostName("example.com"))
                    );
        });

        verifierCase(true, ipv4, factory);
        verifierCase(false, ipv4, factory);

        check("opens pinned IPv6 with port", () -> {
            RecordingHttpsConnection connection = https(
                    "https://[2001:4860:4860:0:0:0:0:8888]:8443/a"
            );
            RecordingOpener opener = new RecordingOpener(connection);

            CallbackPinnedOpen.open(
                    "https://example.com:8443/a",
                    ipv6,
                    opener,
                    factory,
                    new RecordingVerifier(true)
            );

            return "https://[2001:4860:4860:0:0:0:0:8888]:8443/a".equals(
                    opener.url.toString()
            ) && "example.com:8443".equals(connection.getRequestProperty("Host"));
        });

        check("opens matching IP literal with base factory", () -> {
            RecordingHttpsConnection connection = https("https://8.8.8.8/cb");
            RecordingOpener opener = new RecordingOpener(connection);
            RecordingVerifier base = new RecordingVerifier(true);

            CallbackPinnedOpen.open(
                    "https://8.8.8.8/cb",
                    ipv4,
                    opener,
                    factory,
                    base
            );
            boolean answer = connection.getHostnameVerifier().verify("8.8.8.8", null);

            return connection.getSSLSocketFactory() == factory
                    && answer
                    && "8.8.8.8".equals(base.host)
                    && base.session == null;
        });

        rejectedBeforeOpen(
                "rejects mismatched IP literal before opening",
                "https://8.8.8.8/cb",
                otherIpv4,
                factory
        );
        rejectedBeforeOpen(
                "rejects HTTP before opening",
                "http://example.com/cb",
                ipv4,
                factory
        );
        nullDependencyCases(ipv4, factory);

        check("rejects a plain HTTP connection", () -> {
            RecordingOpener opener = new RecordingOpener(
                    new RecordingHttpConnection(new URL("https://8.8.8.8/cb"))
            );
            try {
                CallbackPinnedOpen.open(
                        "https://example.com/cb",
                        ipv4,
                        opener,
                        factory,
                        new RecordingVerifier(true)
                );
                return false;
            } catch (IllegalArgumentException expected) {
                return opener.calls == 1;
            }
        });

        check("forwards opener IOException", () -> {
            IOException failure = new IOException("open failed");
            RecordingOpener opener = new RecordingOpener(failure);
            try {
                CallbackPinnedOpen.open(
                        "https://example.com/cb",
                        ipv4,
                        opener,
                        factory,
                        new RecordingVerifier(true)
                );
                return false;
            } catch (IOException actual) {
                return actual == failure && opener.calls == 1;
            }
        });

        check("system opener configures pinned HTTPS", () -> {
            RecordingVerifier base = new RecordingVerifier(true);
            HttpsURLConnection connection = CallbackPinnedOpen.open(
                    "https://example.com/cb",
                    ipv4,
                    CallbackPinnedOpen.SYSTEM,
                    factory,
                    base
            );
            boolean answer = connection.getHostnameVerifier().verify("8.8.8.8", null);

            return "https://8.8.8.8/cb".equals(connection.getURL().toString())
                    && connection.getSSLSocketFactory() != factory
                    && serverNames(connection.getSSLSocketFactory()).equals(
                            List.of(new SNIHostName("example.com"))
                    )
                    && answer
                    && "example.com".equals(base.host)
                    && base.session == null;
        });

        System.out.println("CallbackPinnedOpenCheck: " + passed + " passed, 0 failed");
    }

    private static void verifierCase(
            boolean expected,
            InetAddress address,
            SSLSocketFactory factory
    ) {
        check("verifier forwards DNS host and " + expected, () -> {
            RecordingHttpsConnection connection = https("https://8.8.8.8/cb");
            RecordingVerifier base = new RecordingVerifier(expected);
            CallbackPinnedOpen.open(
                    "https://example.com/cb",
                    address,
                    new RecordingOpener(connection),
                    factory,
                    base
            );

            boolean answer = connection.getHostnameVerifier().verify("8.8.8.8", null);
            return answer == expected
                    && "example.com".equals(base.host)
                    && base.session == null;
        });
    }

    private static void rejectedBeforeOpen(
            String name,
            String href,
            InetAddress address,
            SSLSocketFactory factory
    ) {
        check(name, () -> {
            RecordingOpener opener = new RecordingOpener(https("https://8.8.8.8/cb"));
            try {
                CallbackPinnedOpen.open(
                        href,
                        address,
                        opener,
                        factory,
                        new RecordingVerifier(true)
                );
                return false;
            } catch (IllegalArgumentException expected) {
                return opener.calls == 0;
            }
        });
    }

    private static void nullDependencyCases(InetAddress address, SSLSocketFactory factory) {
        check("rejects null opener", () -> {
            try {
                CallbackPinnedOpen.open(
                        "https://example.com/cb",
                        address,
                        null,
                        factory,
                        new RecordingVerifier(true)
                );
                return false;
            } catch (IllegalArgumentException expected) {
                return true;
            }
        });
        check("rejects null factory before opening", () -> {
            RecordingOpener opener = new RecordingOpener(https("https://8.8.8.8/cb"));
            try {
                CallbackPinnedOpen.open(
                        "https://example.com/cb",
                        address,
                        opener,
                        null,
                        new RecordingVerifier(true)
                );
                return false;
            } catch (IllegalArgumentException expected) {
                return opener.calls == 0;
            }
        });
        check("rejects null verifier before opening", () -> {
            RecordingOpener opener = new RecordingOpener(https("https://8.8.8.8/cb"));
            try {
                CallbackPinnedOpen.open(
                        "https://example.com/cb",
                        address,
                        opener,
                        factory,
                        null
                );
                return false;
            } catch (IllegalArgumentException expected) {
                return opener.calls == 0;
            }
        });
    }

    private static RecordingHttpsConnection https(String href) {
        try {
            return new RecordingHttpsConnection(new URL(href));
        } catch (Exception error) {
            throw new AssertionError(error);
        }
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

    private static List<SNIServerName> serverNames(SSLSocketFactory factory) throws IOException {
        try (SSLSocket socket = (SSLSocket) factory.createSocket()) {
            return socket.getSSLParameters().getServerNames();
        }
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

    private static final class RecordingOpener implements CallbackPinnedOpen.Opener {
        private final URLConnection connection;
        private final IOException failure;
        private int calls;
        private URL url;

        private RecordingOpener(URLConnection connection) {
            this.connection = connection;
            this.failure = null;
        }

        private RecordingOpener(IOException failure) {
            this.connection = null;
            this.failure = failure;
        }

        @Override
        public URLConnection open(URL url) throws IOException {
            calls++;
            this.url = url;
            if (failure != null) throw failure;
            return connection;
        }
    }

    private static final class RecordingVerifier implements HostnameVerifier {
        private final boolean answer;
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

    private static final class RecordingHttpsConnection extends HttpsURLConnection {
        private int connectCalls;

        private RecordingHttpsConnection(URL url) {
            super(url);
        }

        @Override
        public void connect() {
            connectCalls++;
        }

        @Override
        public void disconnect() {}

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public String getCipherSuite() {
            return null;
        }

        @Override
        public Certificate[] getLocalCertificates() {
            return null;
        }

        @Override
        public Certificate[] getServerCertificates() throws SSLPeerUnverifiedException {
            return null;
        }

        @Override
        public Principal getPeerPrincipal() throws SSLPeerUnverifiedException {
            return null;
        }

        @Override
        public Principal getLocalPrincipal() {
            return null;
        }
    }

    private static final class RecordingHttpConnection extends HttpURLConnection {
        private RecordingHttpConnection(URL url) {
            super(url);
        }

        @Override
        public void connect() {}

        @Override
        public void disconnect() {}

        @Override
        public boolean usingProxy() {
            return false;
        }
    }
}
