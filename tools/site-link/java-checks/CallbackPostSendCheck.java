/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackPinnedOpen;
import io.xchain.wallet.android.links.CallbackPostSend;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.Arrays;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLPeerUnverifiedException;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPostSendCheck {

    private static final String HREF = "https://example.com/cb?x=1";
    private static final String ADDRESS = "8.8.8.8";
    private static final String BODY = "{\"hello\":\"accepted\"}";
    private static final HostnameVerifier VERIFIER = (host, session) -> true;
    private static int passed;

    private CallbackPostSendCheck() {}

    public static void main(String[] args) {
        check("returns 204 and posts request", () -> successCase(204));
        check("returns 500 and posts request", () -> successCase(500));

        refused("redirect follow", HREF, ADDRESS, BODY, "follow", "omit", false);
        refused("credentials include", HREF, ADDRESS, BODY, "manual", "include", false);
        refused("public HTTP", "http://example.com/cb", ADDRESS, BODY,
                "manual", "omit", false);
        refused("loopback without Developer Mode", HREF, "127.0.0.1", BODY,
                "manual", "omit", false);
        refused("hostname address", HREF, "example.com", BODY,
                "manual", "omit", false);
        refused("null address", HREF, null, BODY, "manual", "omit", false);
        refused("null body", HREF, ADDRESS, null, "manual", "omit", false);
        refused("oversized body", HREF, ADDRESS, repeat('x', 10241),
                "manual", "omit", false);

        check("Developer Mode HTTP is refused before opening", () -> {
            RecordingOpener opener = new RecordingOpener(connection(204));
            try {
                send("http://localhost:8080/cb", "127.0.0.1", BODY,
                        "manual", "omit", true, opener);
                return false;
            } catch (IllegalArgumentException expected) {
                return opener.calls == 0;
            }
        });

        check("null opener is refused", () -> {
            try {
                send(HREF, ADDRESS, BODY, "manual", "omit", false, null);
                return false;
            } catch (IllegalArgumentException expected) {
                return true;
            }
        });

        check("opener IOException is unchanged", () -> {
            IOException failure = new IOException("open failed");
            RecordingOpener opener = new RecordingOpener(failure);
            try {
                send(HREF, ADDRESS, BODY, "manual", "omit", false, opener);
                return false;
            } catch (IOException actual) {
                return actual == failure && opener.calls == 1;
            }
        });

        check("output IOException is unchanged and disconnects", () -> {
            IOException failure = new IOException("write failed");
            RecordingConnection connection = connection(204);
            connection.outputFailure = failure;
            try {
                send(HREF, ADDRESS, BODY, "manual", "omit", false,
                        new RecordingOpener(connection));
                return false;
            } catch (IOException actual) {
                return actual == failure && connection.disconnectCalls == 1;
            }
        });

        System.out.println("CallbackPostSendCheck: " + passed + " passed, 0 failed");
    }

    private static boolean successCase(int status) throws Exception {
        RecordingConnection connection = connection(status);
        RecordingOpener opener = new RecordingOpener(connection);

        int answer = send(HREF, ADDRESS, BODY, "manual", "omit", false, opener);

        return answer == status
                && opener.calls == 1
                && "https://8.8.8.8/cb?x=1".equals(opener.url.toString())
                && "example.com".equals(connection.getRequestProperty("Host"))
                && "POST".equals(connection.getRequestMethod())
                && "application/json".equals(
                        connection.getRequestProperty("Content-Type"))
                && !connection.getInstanceFollowRedirects()
                && Arrays.equals(BODY.getBytes(StandardCharsets.UTF_8),
                        connection.output.toByteArray())
                && connection.connectCalls == 0
                && connection.disconnectCalls == 1;
    }

    private static void refused(
            String name,
            String href,
            String address,
            String body,
            String redirect,
            String credentials,
            boolean developerMode
    ) {
        check(name, () -> {
            RecordingOpener opener = new RecordingOpener(connection(204));
            try {
                send(href, address, body, redirect, credentials, developerMode, opener);
                return false;
            } catch (IllegalArgumentException expected) {
                String message = expected.getMessage();
                return "Callback request refused".equals(message)
                        && opener.calls == 0
                        && (href == null || !message.contains(href))
                        && (body == null || !message.contains(body));
            }
        });
    }

    private static int send(
            String href,
            String address,
            String body,
            String redirect,
            String credentials,
            boolean developerMode,
            CallbackPinnedOpen.Opener opener
    ) throws IOException {
        return CallbackPostSend.send(
                href,
                address,
                body,
                10000,
                redirect,
                credentials,
                developerMode,
                opener,
                defaultFactory(),
                VERIFIER
        );
    }

    private static RecordingConnection connection(int status) {
        try {
            return new RecordingConnection(new URL("https://8.8.8.8/cb?x=1"), status);
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

    private static String repeat(char value, int count) {
        char[] values = new char[count];
        Arrays.fill(values, value);
        return new String(values);
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

    private static final class RecordingConnection extends HttpsURLConnection {
        private final int status;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private int connectCalls;
        private int disconnectCalls;
        private IOException outputFailure;

        private RecordingConnection(URL url, int status) {
            super(url);
            this.status = status;
        }

        @Override
        public void connect() {
            connectCalls++;
        }

        @Override
        public void disconnect() {
            disconnectCalls++;
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public OutputStream getOutputStream() throws IOException {
            if (outputFailure != null) throw outputFailure;
            return output;
        }

        @Override
        public int getResponseCode() {
            return status;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(new byte[0]);
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
}
