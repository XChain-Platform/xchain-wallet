package io.xchain.wallet.android.links;

public final class LinkIntakeRule {
    public static final String HOST_WEB = "xchain.io";
    public static final String PATH_PREFIX_WEB = "/wallet/link/";
    public static final String HOST_WALLET = "wallet.xchain.io";
    public static final String PATH_PREFIX_WALLET = "/link/";

    private LinkIntakeRule() {
    }

    public static boolean accepts(
            String scheme,
            String host,
            String encodedPath,
            int urlLength,
            int maxLength) {
        if (maxLength < 1) {
            throw new IllegalArgumentException("maxLength must be positive");
        }
        if (urlLength < 1 || urlLength > maxLength) {
            return false;
        }
        if ("xchain".equalsIgnoreCase(scheme)
                || "bitcoin".equalsIgnoreCase(scheme)
                || "litecoin".equalsIgnoreCase(scheme)
                || "dogecoin".equalsIgnoreCase(scheme)) {
            return true;
        }
        if (!"https".equalsIgnoreCase(scheme) || encodedPath == null) {
            return false;
        }
        if (HOST_WEB.equalsIgnoreCase(host)) {
            return encodedPath.startsWith(PATH_PREFIX_WEB);
        }
        if (HOST_WALLET.equalsIgnoreCase(host)) {
            return encodedPath.startsWith(PATH_PREFIX_WALLET);
        }
        return false;
    }
}
