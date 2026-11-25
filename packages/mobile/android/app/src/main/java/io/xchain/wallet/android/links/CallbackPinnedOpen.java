/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URL;
import java.net.URLConnection;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocketFactory;

public final class CallbackPinnedOpen {

    public interface Opener {
        URLConnection open(URL url) throws IOException;
    }

    public static final Opener SYSTEM = url -> url.openConnection(Proxy.NO_PROXY);

    private CallbackPinnedOpen() {}

    public static HttpsURLConnection open(
            String href,
            InetAddress address,
            Opener opener,
            SSLSocketFactory baseFactory,
            HostnameVerifier baseVerifier
    ) throws IOException {
        if (opener == null || baseFactory == null || baseVerifier == null) {
            throw new IllegalArgumentException("Callback connection dependencies are required");
        }

        URL pinnedUrl = CallbackPinnedTarget.pinnedUrl(href, address);
        URLConnection opened = opener.open(pinnedUrl);
        if (!(opened instanceof HttpsURLConnection)) {
            throw new IllegalArgumentException("Callback connection must use HTTPS");
        }

        HttpsURLConnection connection = (HttpsURLConnection) opened;
        String serverName = CallbackPinnedTarget.serverName(href);
        String verifiedName = serverName == null ? address.getHostAddress() : serverName;
        connection.setRequestProperty("Host", CallbackPinnedTarget.hostHeader(href));
        connection.setSSLSocketFactory(
                CallbackPinnedTarget.withServerName(baseFactory, serverName)
        );
        connection.setHostnameVerifier(
                CallbackPinnedTarget.verifierFor(verifiedName, baseVerifier)
        );
        return connection;
    }
}
