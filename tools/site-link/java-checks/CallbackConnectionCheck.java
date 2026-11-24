/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackConnection;
import io.xchain.wallet.android.links.CallbackPostRule;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class CallbackConnectionCheck {

    private CallbackConnectionCheck() {}

    public static void main(String[] args) {
        try {
            configureCase();
            configureFixedLengthCase();
            postCase(200, "SENT");
            postCase(302, "HTTP_STATUS");
            rejectedBodyCase(null, "null body");
            rejectedBodyCase(repeat('x', CallbackPostRule.MAX_BODY_BYTES + 1), "oversized body");
        } catch (Throwable failure) {
            System.err.println(failure.getMessage());
            System.exit(1);
        }
    }

    private static void configureCase() throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL("https://example.com/cb").openConnection();
        CallbackConnection.configure(connection, 17);

        require("POST".equals(connection.getRequestMethod()), "configure request method");
        require(!connection.getInstanceFollowRedirects(), "configure redirects");
        require(!connection.getUseCaches(), "configure caches");
        require(connection.getDoOutput(), "configure output");
        require(!connection.getAllowUserInteraction(), "configure interaction");
        require(connection.getConnectTimeout() == 10000, "configure connect timeout");
        require(connection.getReadTimeout() == 10000, "configure read timeout");
        require(
                "application/json".equals(connection.getRequestProperty("Content-Type")),
                "configure content type");
        require(connection.getRequestProperty("Cookie") == null, "configure cookie");
        require(connection.getRequestProperty("Authorization") == null, "configure authorization");
    }

    private static void configureFixedLengthCase() throws Exception {
        RecordingConnection connection = new RecordingConnection(200);

        CallbackConnection.configure(connection, 17);

        require(connection.fixedLength == 17, "configure fixed length");
    }

    private static void postCase(int status, String expectedOutcome) throws Exception {
        RecordingConnection connection = new RecordingConnection(status);
        String body = "{\"message\":\"café\"}";

        int actualStatus = CallbackConnection.post(connection, body);

        require(actualStatus == status, "post status " + status);
        require(
                Arrays.equals(body.getBytes(StandardCharsets.UTF_8), connection.output.toByteArray()),
                "post UTF-8 body " + status);
        require(
                "application/json".equals(connection.getRequestProperty("Content-Type")),
                "post content type " + status);
        require(connection.getRequestProperty("Cookie") == null, "post cookie " + status);
        require(
                connection.getRequestProperty("Authorization") == null,
                "post authorization " + status);
        require(connection.outputCalls == 1, "post output count " + status);
        require(
                connection.fixedLength == body.getBytes(StandardCharsets.UTF_8).length,
                "post fixed length " + status);
        require(connection.inputCalls == 1, "post input count " + status);
        require(connection.response.closed, "post response close " + status);
        require(connection.disconnectCalls == 1, "post disconnect count " + status);
        require(
                expectedOutcome.equals(CallbackPostRule.outcome(actualStatus)),
                "post outcome " + status);
    }

    private static void rejectedBodyCase(String body, String name) throws Exception {
        RecordingConnection connection = new RecordingConnection(200);
        try {
            CallbackConnection.post(connection, body);
            throw new AssertionError(name + " accepted");
        } catch (IllegalArgumentException expected) {
            require(connection.outputCalls == 0, name + " opened output");
            require(connection.disconnectCalls == 0, name + " touched disconnect");
        }
    }

    private static String repeat(char value, int count) {
        char[] values = new char[count];
        Arrays.fill(values, value);
        return new String(values);
    }

    private static void require(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
    }

    private static final class RecordingConnection extends HttpURLConnection {
        private final int status;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private final RecordingInputStream response = new RecordingInputStream();
        private int outputCalls;
        private int inputCalls;
        private int disconnectCalls;
        private int fixedLength = -1;

        private RecordingConnection(int status) throws Exception {
            super(new URL("https://example.com/cb"));
            this.status = status;
        }

        @Override
        public void connect() {}

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public OutputStream getOutputStream() {
            outputCalls++;
            return output;
        }

        @Override
        public InputStream getInputStream() {
            inputCalls++;
            return response;
        }

        @Override
        public int getResponseCode() {
            return status;
        }

        @Override
        public void setFixedLengthStreamingMode(int contentLength) {
            fixedLength = contentLength;
        }

        @Override
        public void disconnect() {
            disconnectCalls++;
        }
    }

    private static final class RecordingInputStream extends ByteArrayInputStream {
        private boolean closed;

        private RecordingInputStream() {
            super(new byte[0]);
        }

        @Override
        public void close() throws IOException {
            closed = true;
            super.close();
        }
    }
}
