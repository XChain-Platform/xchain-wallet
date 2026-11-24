/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.io.IOException;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPostSend {

    private CallbackPostSend() {}

    public static int send(
            String href,
            String address,
            String body,
            double timeoutMs,
            String redirect,
            String credentials,
            boolean developerMode,
            CallbackPinnedOpen.Opener opener,
            SSLSocketFactory baseFactory,
            HostnameVerifier baseVerifier
    ) throws IOException {
        CallbackPostRequest request = CallbackPostRequest.check(
                href, address, body, timeoutMs, redirect, credentials, developerMode
        );
        if (request == null) throw new IllegalArgumentException("Callback request refused");

        HttpsURLConnection connection = CallbackPinnedOpen.open(
                request.href, request.address, opener, baseFactory, baseVerifier
        );
        return CallbackConnection.post(connection, request.body);
    }
}
