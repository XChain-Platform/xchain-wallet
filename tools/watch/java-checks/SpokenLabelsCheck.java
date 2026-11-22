import io.xchain.wallet.android.wear.ui.SpokenLabels;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SpokenLabelsCheck {
    private static final Path STRINGS_PATH = Path.of(
            "packages/core/src/watch/contract/strings-balances.json");

    private SpokenLabelsCheck() {}

    public static void main(String[] args) {
        checkEquals("separator", ", ", SpokenLabels.SEPARATOR);
        checkEquals("hidden key", "state.amountHidden", SpokenLabels.HIDDEN_KEY);
        checkEquals(
                "unavailable key",
                "state.balanceUnavailable",
                SpokenLabels.UNAVAILABLE_KEY);

        checkBalanceRow(
                "fiat primary",
                "Bitcoin, $1,234.56",
                "Bitcoin", "$1,234.56", null, null, false, false);
        checkBalanceRow(
                "units primary",
                "Bitcoin, 0.5 BTC",
                "Bitcoin", "0.5 BTC", null, null, false, false);
        checkBalanceRow(
                "price unavailable with units secondary",
                "PEPECASH, No price yet, 1,000 PEPECASH",
                "PEPECASH", "No price yet", "1,000 PEPECASH", null, false, false);
        checkBalanceRow(
                "pending amount",
                "Bitcoin, 0.5 BTC, +0.1 pending",
                "Bitcoin", "0.5 BTC", null, "+0.1 pending", false, false);
        checkBalanceRow(
                "redacted row",
                "Bitcoin, Amount hidden",
                "Bitcoin", "0.5 BTC", null, "+0.1 pending", true, false);
        checkBalanceRow(
                "unavailable takes precedence over redacted",
                "Bitcoin, Balance unavailable",
                "Bitcoin", "0.5 BTC", null, "+0.1 pending", true, true);
        checkBalanceRow(
                "empty secondary and pending dropped",
                "Bitcoin, 0.5 BTC",
                "Bitcoin", "0.5 BTC", "", "", false, false);

        checkEquals(
                "single request line",
                "1 request waiting",
                SpokenLabels.lines("1 request waiting"));
        checkEquals(
                "null and blank lines dropped",
                "Send 0.5 BTC, 0.5 BTC, Expires in 10 min",
                SpokenLabels.lines(
                        "Send 0.5 BTC", null, "", "  ", "0.5 BTC", "Expires in 10 min"));
        checkEquals("no lines", "", SpokenLabels.lines());
        checkEquals("null lines array", "", SpokenLabels.lines((String[]) null));
        checkEquals("only null and empty lines", "", SpokenLabels.lines(null, ""));

        checkContractKey(SpokenLabels.HIDDEN_KEY);
        checkContractKey(SpokenLabels.UNAVAILABLE_KEY);

        System.out.println("SpokenLabelsCheck: PASS");
    }

    private static void checkBalanceRow(
            String caseName,
            String expected,
            String name,
            String primary,
            String secondary,
            String pendingText,
            boolean redacted,
            boolean unavailable) {
        checkEquals(
                caseName,
                expected,
                SpokenLabels.balanceRow(
                        name,
                        primary,
                        secondary,
                        pendingText,
                        redacted,
                        unavailable,
                        "Amount hidden",
                        "Balance unavailable"));
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

    private static void checkEquals(String caseName, String expected, String actual) {
        check(expected.equals(actual), caseName);
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("SpokenLabelsCheck: FAIL: " + caseName);
        System.exit(1);
    }
}
