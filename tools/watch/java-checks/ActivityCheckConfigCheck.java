import io.xchain.wallet.android.activity.ActivityCheckConfig;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ActivityCheckConfigCheck {

    private ActivityCheckConfigCheck() {}

    public static void main(String[] args) {
        ActivityCheckConfig exact = ActivityCheckConfig.fromTree(map(
                "enabled", true,
                "targets", Arrays.asList(
                        target("first", "https://one.invalid", "0.5", "0"),
                        target("second", "https://two.invalid", null, null)),
                "notice", map("title", "Balance changed", "body", "Open the wallet"),
                "openOnPhoneTitle", "Open on phone"));
        require("exact tree parses", exact != null);
        require("exact enabled", exact.enabled);
        require("exact target count", exact.targets.size() == 2);
        checkTarget("first target", exact.targets.get(0),
                "first", "https://one.invalid", "balances.confirmed", "balances.pending", "0.5", "0");
        checkTarget("second target", exact.targets.get(1),
                "second", "https://two.invalid", "balances.confirmed", "balances.pending", null, null);
        require("notice title", "Balance changed".equals(exact.noticeTitle));
        require("notice body", "Open the wallet".equals(exact.noticeBody));
        require("open on phone title", "Open on phone".equals(exact.openOnPhoneTitle));
        require("exact runnable", exact.isRunnable());
        require("addresses in order", Arrays.asList("first", "second").equals(exact.addresses()));

        ActivityCheckConfig disabled = config(false, Arrays.asList(validTarget()));
        require("disabled reads false", !disabled.enabled);
        require("disabled is not runnable", !disabled.isRunnable());
        require("integer enabled reads false", !config(1, Arrays.asList(validTarget())).enabled);
        require("string enabled reads false", !config("true", Arrays.asList(validTarget())).enabled);
        require("absent enabled reads false", !ActivityCheckConfig.fromTree(
                map("targets", Arrays.asList(validTarget()))).enabled);
        require("empty targets is not runnable", !config(true, new ArrayList<>()).isRunnable());

        Map<String, Object> missingUrl = validTarget();
        missingUrl.remove("url");
        Map<String, Object> emptyAddress = validTarget();
        emptyAddress.put("address", "");
        Map<String, Object> numericPendingPath = validTarget();
        numericPendingPath.put("pendingPath", 1);
        ActivityCheckConfig filtered = config(true, Arrays.asList(
                missingUrl,
                emptyAddress,
                numericPendingPath,
                validTarget()));
        require("invalid targets dropped", filtered.targets.size() == 1);
        require("valid neighboring target kept", "valid".equals(filtered.targets.get(0).address));

        Map<String, Object> numericConfirmed = validTarget();
        numericConfirmed.put("confirmed", 5);
        ActivityCheckConfig optionalValues = ActivityCheckConfig.fromTree(map(
                "enabled", true,
                "targets", Arrays.asList(numericConfirmed),
                "openOnPhoneTitle", "  "));
        require("numeric confirmed reads null", optionalValues.targets.get(0).confirmed == null);
        require("whitespace open title reads null", optionalValues.openOnPhoneTitle == null);
        require("missing notice title reads null", optionalValues.noticeTitle == null);
        require("missing notice body reads null", optionalValues.noticeBody == null);

        require("null tree gives null", ActivityCheckConfig.fromTree(null) == null);
        require("string tree gives null", ActivityCheckConfig.fromTree("tree") == null);
        require("list tree gives null", ActivityCheckConfig.fromTree(new ArrayList<>()) == null);

        boolean refusedAdd = false;
        try {
            exact.targets.add(exact.targets.get(0));
        } catch (UnsupportedOperationException expected) {
            refusedAdd = true;
        }
        require("targets refuses add", refusedAdd);
    }

    private static ActivityCheckConfig config(Object enabled, List<?> targets) {
        return ActivityCheckConfig.fromTree(map("enabled", enabled, "targets", targets));
    }

    private static Map<String, Object> target(
            String address,
            String url,
            String confirmed,
            String pending) {
        Map<String, Object> target = map(
                "address", address,
                "url", url,
                "confirmedPath", "balances.confirmed",
                "pendingPath", "balances.pending");
        if (confirmed != null) {
            target.put("confirmed", confirmed);
        }
        if (pending != null) {
            target.put("pending", pending);
        }
        return target;
    }

    private static Map<String, Object> validTarget() {
        return target("valid", "https://valid.invalid", null, null);
    }

    private static void checkTarget(
            String name,
            ActivityCheckConfig.Target actual,
            String address,
            String url,
            String confirmedPath,
            String pendingPath,
            String confirmed,
            String pending) {
        require(name + " address", address.equals(actual.address));
        require(name + " url", url.equals(actual.url));
        require(name + " confirmed path", confirmedPath.equals(actual.confirmedPath));
        require(name + " pending path", pendingPath.equals(actual.pendingPath));
        require(name + " confirmed", equals(confirmed, actual.confirmed));
        require(name + " pending", equals(pending, actual.pending));
    }

    private static boolean equals(Object expected, Object actual) {
        return expected == null ? actual == null : expected.equals(actual);
    }

    private static void require(String name, boolean condition) {
        if (!condition) {
            System.err.println("failed: " + name);
            System.exit(1);
        }
    }

    private static Map<String, Object> map(Object... entries) {
        Map<String, Object> result = new HashMap<>();
        for (int index = 0; index < entries.length; index += 2) {
            result.put((String) entries[index], entries[index + 1]);
        }
        return result;
    }
}
