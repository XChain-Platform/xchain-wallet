import io.xchain.wallet.android.wear.data.WatchPaths;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class WatchPathsCheck {
    private static final String HASH =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private WatchPathsCheck() {
    }

    public static void main(String[] args) {
        check("PREFIX constant", "/xc/".equals(WatchPaths.PREFIX));
        check("SNAPSHOT constant", "/xc/snapshot".equals(WatchPaths.SNAPSHOT));
        check("STATE constant", "/xc/state".equals(WatchPaths.STATE));
        check("DETAIL_PREFIX constant", "/xc/detail/".equals(WatchPaths.DETAIL_PREFIX));
        check("IMAGE_PREFIX constant", "/xc/image/".equals(WatchPaths.IMAGE_PREFIX));
        check("PHONE_CAPABILITY constant", "xchain_phone".equals(WatchPaths.PHONE_CAPABILITY));

        checkIncoming("snapshot path", WatchPaths.classify("/xc/snapshot"),
                WatchPaths.Kind.SNAPSHOT, null);
        checkIncoming("state path", WatchPaths.classify("/xc/state"),
                WatchPaths.Kind.STATE, null);
        checkIncoming("detail path", WatchPaths.classify("/xc/detail/account-7"),
                WatchPaths.Kind.DETAIL, "account-7");
        checkNull("empty detail id", WatchPaths.classify("/xc/detail/"));
        checkIncoming("image path", WatchPaths.classify("/xc/image/" + HASH),
                WatchPaths.Kind.IMAGE, HASH);

        checkNull("uppercase image hash", WatchPaths.classify("/xc/image/" + HASH.toUpperCase()));
        checkNull("63-character image hash", WatchPaths.classify("/xc/image/" + HASH.substring(1)));
        checkNull("non-hex image hash", WatchPaths.classify("/xc/image/" + HASH.substring(0, 63) + "g"));
        checkNull("null path", WatchPaths.classify(null));
        checkNull("snapshot child path", WatchPaths.classify("/xc/snapshot/x"));
        checkNull("incorrect prefix", WatchPaths.classify("/xcx/snapshot"));
        checkNull("missing leading slash", WatchPaths.classify("xc/snapshot"));

        WatchPaths.Incoming detail = new WatchPaths.Incoming(WatchPaths.Kind.DETAIL, "account-7");
        WatchPaths.Incoming equalDetail = new WatchPaths.Incoming(WatchPaths.Kind.DETAIL, "account-7");
        check("Incoming equals", detail.equals(equalDetail));
        check("Incoming hashCode", detail.hashCode() == equalDetail.hashCode());
        check("Incoming toString", detail.toString().contains("DETAIL")
                && detail.toString().contains("account-7"));

        checkPhoneCapability();
    }

    private static void checkIncoming(String name, WatchPaths.Incoming actual,
            WatchPaths.Kind kind, String key) {
        check(name, actual != null && actual.kind == kind
                && (key == null ? actual.key == null : key.equals(actual.key)));
    }

    private static void checkNull(String name, Object actual) {
        check(name, actual == null);
    }

    private static void checkPhoneCapability() {
        Path resource = Paths.get(
                "packages/mobile/android/app/src/main/res/values/wear.xml");
        String xml;
        try {
            xml = new String(Files.readAllBytes(resource), StandardCharsets.UTF_8);
        } catch (IOException error) {
            fail("PHONE_CAPABILITY resource readable: " + error.getMessage());
            return;
        }

        Matcher matcher = Pattern.compile("<item>\\s*([^<]+?)\\s*</item>").matcher(xml);
        List<String> items = new ArrayList<>();
        while (matcher.find()) {
            items.add(matcher.group(1));
        }
        check("PHONE_CAPABILITY is the one wear.xml item",
                items.size() == 1 && WatchPaths.PHONE_CAPABILITY.equals(items.get(0)));
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
