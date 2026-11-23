/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import io.xchain.wallet.android.links.CallbackPostRule;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class CallbackPostRuleCheck {

    private static int passed;

    private CallbackPostRuleCheck() {}

    public static void main(String[] args) {
        check("timeout constant", CallbackPostRule.TIMEOUT_MS == sourceLiteral(
                "packages/core/src/site_request/callbackSend.js", "CALLBACK_TIMEOUT_MS\\s*=\\s*(\\d+)"));
        check("body limit constant", CallbackPostRule.MAX_BODY_BYTES == sourceLiteral(
                "packages/core/src/site_request/claim.js", "CALLBACK_BODY_MAX_BYTES\\s*=\\s*(\\d+)"));
        check("target length constant", CallbackPostRule.MAX_TARGET_LENGTH == sourceLiteral(
                "packages/core/src/site_request/callbackSend.js", "url\\.length\\s*>\\s*(\\d+)"));

        accepted("HTTPS", "https://example.com/cb", false);
        accepted("HTTPS in Developer Mode", "https://example.com/cb", true);
        developerOnly("localhost", "http://localhost:8080/cb");
        developerOnly("case-insensitive localhost", "http://LOCALHOST:8080/cb");
        developerOnly("IPv4 loopback", "http://127.0.0.1/cb");
        developerOnly("IPv6 loopback", "http://[::1]:3000/cb");
        refused("public HTTP in Developer Mode", "http://example.com/cb", true);
        refused("missing host", "https:/cb", false);
        refused("empty host", "https:///cb", false);
        refused("user info", "https://user:pass@example.com/", false);
        refused("fragment", "https://example.com/#x", false);
        refused("JavaScript scheme", "javascript:alert(1)", false);
        refused("FTP scheme", "ftp://example.com/", false);
        refused("null target", null, false);

        String targetPrefix = "https://example.com/";
        accepted("2,048-character target", targetPrefix + repeat('a', 2048 - targetPrefix.length()), false);
        refused("2,049-character target", targetPrefix + repeat('a', 2049 - targetPrefix.length()), false);

        fits("10,240-byte ASCII body", repeat('a', 10240));
        doesNotFit("10,241-byte ASCII body", repeat('a', 10241));
        doesNotFit("10,242-byte three-byte body", repeat('\u20ac', 3414));
        doesNotFit("null body", null);

        sent(200);
        sent(204);
        sent(299);
        httpStatus(199);
        httpStatus(302);
        httpStatus(304);
        httpStatus(404);
        httpStatus(500);

        System.out.println("CallbackPostRuleCheck: " + passed + " passed, 0 failed");
    }

    private static int sourceLiteral(String file, String expression) {
        try {
            String source = new String(Files.readAllBytes(path(file)), StandardCharsets.UTF_8);
            Matcher matcher = Pattern.compile(expression).matcher(source);
            check("source literal " + expression, matcher.find());
            return Integer.parseInt(matcher.group(1));
        } catch (IOException | RuntimeException exception) {
            fail("source literal " + expression);
            return -1;
        }
    }

    private static Path path(String file) {
        return Paths.get(file);
    }

    private static void developerOnly(String name, String href) {
        refused(name + " without Developer Mode", href, false);
        accepted(name + " with Developer Mode", href, true);
    }

    private static void accepted(String name, String href, boolean developerMode) {
        check(name, CallbackPostRule.acceptsTarget(href, developerMode));
    }

    private static void refused(String name, String href, boolean developerMode) {
        check(name, !CallbackPostRule.acceptsTarget(href, developerMode));
    }

    private static void fits(String name, String body) {
        check(name, CallbackPostRule.bodyFits(body));
    }

    private static void doesNotFit(String name, String body) {
        check(name, !CallbackPostRule.bodyFits(body));
    }

    private static void sent(int status) {
        check(status + " outcome", "SENT".equals(CallbackPostRule.outcome(status)));
    }

    private static void httpStatus(int status) {
        check(status + " outcome", "HTTP_STATUS".equals(CallbackPostRule.outcome(status)));
    }

    private static String repeat(char value, int count) {
        char[] values = new char[count];
        for (int index = 0; index < values.length; index++) values[index] = value;
        return new String(values);
    }

    private static void check(String name, boolean condition) {
        if (!condition) fail(name);
        passed++;
    }

    private static void fail(String name) {
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
