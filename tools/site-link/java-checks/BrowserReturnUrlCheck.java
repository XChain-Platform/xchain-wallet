// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.links.BrowserReturnUrl;

public final class BrowserReturnUrlCheck {

    private static int passed;

    private BrowserReturnUrlCheck() {}

    public static void main(String[] args) {
        checkUnchanged("reserved URL characters", "https://example.com/done?x=1&y=a\\|b#xchain=eyJ9");
        checkUnchanged("uppercase HTTPS", "HTTPS://Example.com/a");
        checkUnchanged("IPv6 authority", "https://[2001:db8::1]:8443/r?q=[1]#xchain=AA");
        checkUnchanged("percent-encoded path", "https://example.com/caf%C3%A9");

        String longPrefix = "https://example.com/done#xchain=";
        String maximumLength = longPrefix + "A".repeat(16_384 - longPrefix.length());
        check("maximum URL length", maximumLength.length() == 16_384);
        checkUnchanged("maximum URL", maximumLength);

        checkNull("null", null);
        checkNull("empty", "");
        checkNull("HTTP", "http://example.com/");
        checkNull("intent scheme", "intent://example.com/#Intent;scheme=https;end");
        checkNull("JavaScript scheme", "javascript:alert(1)");
        checkNull("wallet scheme", "xchain:send");
        checkNull("empty authority", "https://");
        checkNull("path without authority", "https:///path");
        checkNull("port without host", "https://:443/");
        checkNull("username", "https://user@example.com/");
        checkNull("username and password", "https://user:pw@example.com/");
        checkNull("space", "https://exa mple.com/");
        checkNull("newline", "https://example.com/a\nb");
        for (int character = 0; character <= 0x20; character++) {
            checkNull("ASCII control or space " + character, "https://example.com/a" + (char) character);
        }
        checkNull("ASCII DEL", "https://example.com/a\u007f");
        checkNull("query without authority", "https://?query");
        checkNull("fragment without authority", "https://#fragment");

        System.out.println("BrowserReturnUrlCheck: " + passed + " passed, 0 failed");
    }

    private static void checkUnchanged(String name, String url) {
        check(name, BrowserReturnUrl.checked(url) == url);
    }

    private static void checkNull(String name, String url) {
        check(name, BrowserReturnUrl.checked(url) == null);
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
        passed++;
    }
}
