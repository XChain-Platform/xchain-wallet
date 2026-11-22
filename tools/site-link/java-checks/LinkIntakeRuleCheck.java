import io.xchain.wallet.android.links.LinkIntakeRule;

public final class LinkIntakeRuleCheck {
    private static final int MAX_LENGTH = 100;

    private LinkIntakeRuleCheck() {
    }

    public static void main(String[] args) {
        checkAccepts("xchain", null, null, 1, "lowercase xchain scheme");
        checkAccepts("XCHAIN", null, null, 1, "uppercase xchain scheme");
        checkAccepts("bitcoin", null, null, 1, "lowercase bitcoin scheme");
        checkAccepts("BITCOIN", null, null, 1, "uppercase bitcoin scheme");
        checkAccepts("litecoin", null, null, 1, "lowercase litecoin scheme");
        checkAccepts("LITECOIN", null, null, 1, "uppercase litecoin scheme");
        checkAccepts("dogecoin", null, null, 1, "lowercase dogecoin scheme");
        checkAccepts("DOGECOIN", null, null, 1, "uppercase dogecoin scheme");

        checkAccepts("https", "xchain.io", "/wallet/link/send", 1,
                "web host with web prefix");
        checkAccepts("https", "wallet.xchain.io", "/link/send", 1,
                "wallet host with wallet prefix");
        checkRefuses("https", "xchain.io", "/link/send", 1,
                "web host with wallet prefix");
        checkRefuses("https", "wallet.xchain.io", "/wallet/link/send", 1,
                "wallet host with web prefix");
        checkAccepts("HTTPS", "XChain.IO", "/wallet/link/send", 1,
                "uppercase https and mixed-case web host");

        checkRefuses("http", "xchain.io", "/wallet/link/send", 1, "http scheme");
        checkRefuses("https", "xchain.io.evil.com", "/wallet/link/send", 1,
                "web host suffix attack");
        checkRefuses("https", "evil.com", "/wallet/link/send", 1, "unclaimed host");
        checkRefuses("https", "wallet.xchain.io.evil.com", "/link/send", 1,
                "wallet host suffix attack");
        checkRefuses("https", "xchain.io", "/wallet/link", 1,
                "web path without trailing slash");
        checkRefuses("https", "wallet.xchain.io", "/linkage/", 1,
                "wallet path prefix lookalike");
        checkRefuses("https", "xchain.io", "/privacy/", 1, "unclaimed path");

        checkRefuses(null, "xchain.io", "/wallet/link/send", 1, "null scheme");
        checkRefuses("https", null, "/wallet/link/send", 1, "null host");
        checkRefuses("https", "xchain.io", null, 1, "null path");

        checkRefuses("xchain", null, null, 0, "zero URL length");
        checkAccepts("xchain", null, null, MAX_LENGTH, "URL length equal to maximum");
        checkRefuses("xchain", null, null, MAX_LENGTH + 1,
                "URL length greater than maximum");
        checkInvalidMaximum();
    }

    private static void checkAccepts(
            String scheme,
            String host,
            String encodedPath,
            int urlLength,
            String caseName) {
        check(LinkIntakeRule.accepts(
                scheme, host, encodedPath, urlLength, MAX_LENGTH), caseName);
    }

    private static void checkRefuses(
            String scheme,
            String host,
            String encodedPath,
            int urlLength,
            String caseName) {
        check(!LinkIntakeRule.accepts(
                scheme, host, encodedPath, urlLength, MAX_LENGTH), caseName);
    }

    private static void checkInvalidMaximum() {
        try {
            LinkIntakeRule.accepts("xchain", null, null, 1, 0);
            fail("zero maximum length throws");
        } catch (IllegalArgumentException expected) {
            return;
        }
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("FAILED: " + caseName);
        System.exit(1);
    }
}
