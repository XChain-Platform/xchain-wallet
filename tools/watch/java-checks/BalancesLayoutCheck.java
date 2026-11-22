import io.xchain.wallet.android.wear.ui.BalancesLayout;
import io.xchain.wallet.android.wear.ui.BalancesLayout.Item;
import io.xchain.wallet.android.wear.ui.BalancesLayout.Kind;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class BalancesLayoutCheck {
    private static final Path STRINGS_PATH = Path.of(
            "packages/core/src/watch/contract/strings-balances.json");

    private BalancesLayoutCheck() {}

    public static void main(String[] args) {
        check(BalancesLayout.ROW_LIMIT == 50, "row limit");

        checkItems("no rows", BalancesLayout.items(0, false, false),
                item(Kind.EMPTY, -1));
        checkItems("no rows with request", BalancesLayout.items(0, true, false),
                item(Kind.REQUEST, -1),
                item(Kind.EMPTY, -1));
        checkItems("three rows with request", BalancesLayout.items(3, true, false),
                item(Kind.REQUEST, -1),
                item(Kind.ROW, 0),
                item(Kind.ROW, 1),
                item(Kind.ROW, 2));

        List<Item> fiftyRowsCapped = rows(50);
        fiftyRowsCapped.add(item(Kind.MORE_ON_PHONE, -1));
        checkItems("50 rows capped", BalancesLayout.items(50, false, true),
                fiftyRowsCapped.toArray(new Item[0]));

        checkItems("60 rows clamped", BalancesLayout.items(60, false, false),
                rows(50).toArray(new Item[0]));
        checkItems("capped with no rows", BalancesLayout.items(0, false, true),
                item(Kind.EMPTY, -1));
        checkItems("negative count", BalancesLayout.items(-3, false, true),
                item(Kind.EMPTY, -1));

        List<Item> unmodifiable = BalancesLayout.items(1, false, false);
        try {
            unmodifiable.add(item(Kind.ROW, 1));
            fail("unmodifiable list");
        } catch (UnsupportedOperationException expected) {
        }

        check(item(Kind.ROW, 4).equals(item(Kind.ROW, 4)), "item equality");
        check(!item(Kind.ROW, 4).equals(item(Kind.ROW, 5)), "item inequality");
        check(item(Kind.ROW, 4).hashCode() == item(Kind.ROW, 4).hashCode(),
                "item hash code");
        check(item(Kind.ROW, 4).toString().contains("ROW")
                        && item(Kind.ROW, 4).toString().contains("4"),
                "item toString");

        checkTextKey("request text key", item(Kind.REQUEST, -1), "w1.requestWaiting");
        checkTextKey("row text key", item(Kind.ROW, 0), null);
        checkTextKey("more text key", item(Kind.MORE_ON_PHONE, -1), "state.moreOnPhone");
        checkTextKey("empty text key", item(Kind.EMPTY, -1), "w1.empty");

        check("w1.title".equals(BalancesLayout.headerKey(false)), "units header");
        check(BalancesLayout.headerKey(true) == null, "fiat header");
        checkContractKey("w1.title");

        System.out.println("BalancesLayoutCheck: PASS");
    }

    private static List<Item> rows(int count) {
        List<Item> result = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            result.add(item(Kind.ROW, index));
        }
        return result;
    }

    private static Item item(Kind kind, int index) {
        return new Item(kind, index);
    }

    private static void checkItems(String name, List<Item> actual, Item... expected) {
        check(actual.equals(List.of(expected)), name);
    }

    private static void checkTextKey(String name, Item item, String expected) {
        String actual = BalancesLayout.textKey(item);
        check(expected == null ? actual == null : expected.equals(actual), name);
        if (actual != null) {
            checkContractKey(actual);
        }
    }

    private static void checkContractKey(String key) {
        String contract;
        try {
            contract = Files.readString(STRINGS_PATH, StandardCharsets.UTF_8);
        } catch (IOException error) {
            fail("read strings contract");
            return;
        }
        check(contract.contains("\"" + key + "\""), "contract key " + key);
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("BalancesLayoutCheck: FAIL: " + name);
        System.exit(1);
    }
}
