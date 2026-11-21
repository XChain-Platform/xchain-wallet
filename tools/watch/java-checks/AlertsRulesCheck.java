import io.xchain.wallet.android.wear.ui.AlertsRules;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class AlertsRulesCheck {
    private static final class Item {
        private final String id;
        private final long at;

        private Item(String id, long at) {
            this.id = id;
            this.at = at;
        }
    }

    private AlertsRulesCheck() {}

    public static void main(String[] args) throws Exception {
        checkNewestFirstLimitAndOrder();
        checkNewestFirstStability();
        checkNewestFirstEmptyInputs();
        checkNewestFirstIsUnmodifiable();
        checkHasUnread();
        checkEmptyTextKey();
        checkDetailBody();
        checkIsExpired();
        checkStringKeys();
        System.out.println("AlertsRulesCheck: all specified cases passed");
    }

    private static void checkNewestFirstLimitAndOrder() {
        require(AlertsRules.LIST_LIMIT == 20, "LIST_LIMIT is 20");
        List<Item> items = new ArrayList<>();
        int[] shuffled = {7, 22, 3, 18, 0, 24, 11, 5, 16, 2, 20, 9, 14,
                1, 23, 6, 12, 19, 4, 17, 8, 21, 10, 15, 13};
        for (int value : shuffled) {
            items.add(new Item("item-" + value, value));
        }

        List<Item> result = AlertsRules.newestFirst(items, item -> item.at);
        require(result.size() == 20, "newestFirst limits 25 items to 20");
        for (int index = 0; index < 20; index++) {
            int expected = 24 - index;
            require(result.get(index).id.equals("item-" + expected),
                    "newestFirst sorts 25 shuffled items descending");
        }
    }

    private static void checkNewestFirstStability() {
        Item first = new Item("first", 10);
        Item second = new Item("second", 10);
        List<Item> result = AlertsRules.newestFirst(
                Arrays.asList(new Item("older", 9), first, second), item -> item.at);
        require(result.get(0) == first && result.get(1) == second,
                "newestFirst preserves input order for equal timestamps");
    }

    private static void checkNewestFirstEmptyInputs() {
        require(AlertsRules.newestFirst(Collections.<Item>emptyList(), item -> item.at).isEmpty(),
                "newestFirst returns empty for an empty list");
        require(AlertsRules.newestFirst(null, (Item item) -> item.at).isEmpty(),
                "newestFirst returns empty for null");
    }

    private static void checkNewestFirstIsUnmodifiable() {
        List<Item> result = AlertsRules.newestFirst(
                Collections.singletonList(new Item("only", 1)), item -> item.at);
        try {
            result.add(new Item("added", 2));
            fail("newestFirst returns an unmodifiable list");
        } catch (UnsupportedOperationException expected) {
            require(true, "newestFirst returns an unmodifiable list");
        }
    }

    private static void checkHasUnread() {
        require(!AlertsRules.hasUnread(new boolean[] {true, true}),
                "hasUnread is false when none are unread");
        require(AlertsRules.hasUnread(new boolean[] {true, false, true}),
                "hasUnread is true when one is unread");
        require(AlertsRules.hasUnread(new boolean[] {false, false}),
                "hasUnread is true when all are unread");
        require(!AlertsRules.hasUnread(null), "hasUnread is false for null");
    }

    private static void checkEmptyTextKey() {
        require("w3.empty".equals(AlertsRules.emptyTextKey(0)),
                "emptyTextKey returns w3.empty at zero");
        require(AlertsRules.emptyTextKey(1) == null,
                "emptyTextKey returns null above zero");
    }

    private static void checkDetailBody() {
        require(AlertsRules.detailBody(null) == null, "detailBody hides null");
        require(AlertsRules.detailBody("") == null, "detailBody hides an empty string");
        require(AlertsRules.detailBody("  \n") == null,
                "detailBody hides whitespace-only text");
        String body = " Sent ";
        require(AlertsRules.detailBody(body) == body,
                "detailBody returns non-empty text unchanged");
    }

    private static void checkIsExpired() {
        long now = 1_000L;
        require(!AlertsRules.isExpired(null, now), "isExpired is false for null");
        require(!AlertsRules.isExpired(now + 1, now),
                "isExpired is false one millisecond before expiry");
        require(AlertsRules.isExpired(now, now), "isExpired is true at the boundary");
        require(AlertsRules.isExpired(now - 1, now),
                "isExpired is true one millisecond after expiry");
    }

    private static void checkStringKeys() throws Exception {
        String strings = Files.readString(
                Path.of("packages/core/src/watch/contract/strings-alerts.json"),
                StandardCharsets.UTF_8);
        require(strings.contains("\"w3.empty\""),
                "strings-alerts.json contains the quoted w3.empty key");
        require(strings.contains("\"w4.requestExpired\""),
                "strings-alerts.json contains the quoted w4.requestExpired key");
    }

    private static void require(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("AlertsRulesCheck failed: " + caseName);
        System.exit(1);
    }
}
