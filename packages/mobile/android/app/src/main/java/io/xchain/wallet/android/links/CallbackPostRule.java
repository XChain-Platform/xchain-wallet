/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.links;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;

public final class CallbackPostRule {

    public static final int TIMEOUT_MS = 10000;
    public static final int MAX_BODY_BYTES = 10240;
    public static final int MAX_TARGET_LENGTH = 2048;

    private CallbackPostRule() {}

    public static boolean acceptsTarget(String href, boolean developerMode) {
        if (href == null || href.length() > MAX_TARGET_LENGTH || href.indexOf('#') >= 0) return false;

        URI target;
        try {
            target = new URI(href);
        } catch (URISyntaxException exception) {
            return false;
        }

        String host = target.getHost();
        if (host == null || host.isEmpty() || target.getRawUserInfo() != null) return false;

        String scheme = target.getScheme();
        if ("https".equalsIgnoreCase(scheme)) return true;
        return "http".equalsIgnoreCase(scheme) && developerMode && isLocalhost(host);
    }

    public static boolean bodyFits(String body) {
        return body != null && body.getBytes(StandardCharsets.UTF_8).length <= MAX_BODY_BYTES;
    }

    public static String outcome(int status) {
        return status >= 200 && status <= 299 ? "SENT" : "HTTP_STATUS";
    }

    private static boolean isLocalhost(String host) {
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equalsIgnoreCase(host)
                || "::1".equalsIgnoreCase(host)
                || "[::1]".equalsIgnoreCase(host);
    }
}
