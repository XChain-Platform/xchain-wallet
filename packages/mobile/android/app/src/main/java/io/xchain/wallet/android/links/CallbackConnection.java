/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;

public final class CallbackConnection {

    private CallbackConnection() {}

    public static void configure(HttpURLConnection connection, int bodyLength) throws IOException {
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setDoOutput(true);
        connection.setAllowUserInteraction(false);
        connection.setConnectTimeout(CallbackPostRule.TIMEOUT_MS);
        connection.setReadTimeout(CallbackPostRule.TIMEOUT_MS);
        connection.setFixedLengthStreamingMode(bodyLength);
        connection.setRequestProperty("Content-Type", "application/json");
    }

    public static int post(HttpURLConnection connection, String body) throws IOException {
        if (!CallbackPostRule.bodyFits(body)) {
            throw new IllegalArgumentException("Invalid callback body");
        }

        byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
        try {
            configure(connection, bodyBytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bodyBytes);
            }

            int status = connection.getResponseCode();
            InputStream response = connection.getErrorStream();
            if (response == null) response = connection.getInputStream();
            if (response != null) response.close();
            return status;
        } finally {
            connection.disconnect();
        }
    }
}
