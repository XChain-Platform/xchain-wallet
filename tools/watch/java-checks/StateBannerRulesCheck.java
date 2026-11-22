import io.xchain.wallet.android.wear.ui.StateBannerRules;
import io.xchain.wallet.android.wear.ui.StateBannerRules.AgeLine;
import io.xchain.wallet.android.wear.ui.StateBannerRules.Banner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class StateBannerRulesCheck {
    private StateBannerRulesCheck() {
    }

    public static void main(String[] args) {
        checkEquals(
                "no snapshot banners",
                Collections.singletonList(Banner.LOADING),
                StateBannerRules.banners(false, "locked", false, true));
        checkEquals(
                "no snapshot age line",
                null,
                StateBannerRules.ageLine(false, true, true));
        checkEquals(
                "unlocked reachable fresh",
                Collections.emptyList(),
                StateBannerRules.banners(true, "unlocked", true, false));
        checkEquals(
                "all applicable banners in order",
                Arrays.asList(Banner.LOCKED, Banner.UNREACHABLE, Banner.STALE_24H),
                StateBannerRules.banners(true, "locked", false, true));

        checkNotLocked("null session", null);
        checkNotLocked("empty session", "");
        checkNotLocked("unknown session", "unknown");

        List<Banner> banners = StateBannerRules.banners(true, "locked", true, false);
        try {
            banners.add(Banner.UNREACHABLE);
            fail("returned list refuses add");
        } catch (UnsupportedOperationException expected) {
        }

        checkEquals("age line without snapshot", null, StateBannerRules.ageLine(false, true, false));
        checkEquals("age line without balancesAt", null, StateBannerRules.ageLine(true, false, true));
        checkEquals("normal age line", AgeLine.AGE, StateBannerRules.ageLine(true, true, false));
        checkEquals("amber age line", AgeLine.AGE_AMBER, StateBannerRules.ageLine(true, true, true));

        checkEquals("loading text key", "state.loading", Banner.LOADING.textKey());
        checkEquals("locked text key", "state.locked", Banner.LOCKED.textKey());
        checkEquals("unreachable text key", "state.unreachable", Banner.UNREACHABLE.textKey());
        checkEquals("stale text key", "state.stale24h", Banner.STALE_24H.textKey());
        checkEquals("age text key", "state.age", AgeLine.AGE.textKey());
        checkEquals("amber age text key", "state.ageAmber", AgeLine.AGE_AMBER.textKey());

        String contract = readContract();
        checkContractKey(contract, Banner.LOADING.textKey());
        checkContractKey(contract, Banner.LOCKED.textKey());
        checkContractKey(contract, Banner.UNREACHABLE.textKey());
        checkContractKey(contract, Banner.STALE_24H.textKey());
        checkContractKey(contract, AgeLine.AGE.textKey());
        checkContractKey(contract, AgeLine.AGE_AMBER.textKey());
    }

    private static void checkNotLocked(String name, String session) {
        checkEquals(
                name,
                Collections.emptyList(),
                StateBannerRules.banners(true, session, true, false));
    }

    private static String readContract() {
        try {
            return new String(
                    Files.readAllBytes(Paths.get(
                            "packages/core/src/watch/contract/strings-balances.json")),
                    StandardCharsets.UTF_8);
        } catch (IOException exception) {
            fail("read strings-balances contract: " + exception.getMessage());
            return "";
        }
    }

    private static void checkContractKey(String contract, String key) {
        if (!contract.contains("\"" + key + "\"")) {
            fail("contract key " + key);
        }
    }

    private static void checkEquals(String name, Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            fail(name + ": expected " + expected + ", got " + actual);
        }
    }

    private static void fail(String name) {
        System.err.println("FAIL: " + name);
        System.exit(1);
    }
}
