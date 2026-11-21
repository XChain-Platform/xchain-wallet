import io.xchain.wallet.android.activity.ActivityCheckResponse;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ActivityCheckResponseCheck {

    private ActivityCheckResponseCheck() {}

    public static void main(String[] args) {
        Map<String, Object> balances = map(
                "confirmed", "0.5",
                "pending", "-0.1");
        check("both strings in order", map("balances", balances), Arrays.asList("0.5", "-0.1"));

        Map<String, Object> nullPending = map(
                "confirmed", "0.5",
                "pending", null);
        check("null pending", map("balances", nullPending), null);

        check("absent pending", map("balances", map("confirmed", "0.5")), null);
        check("numeric confirmed", map("balances", map(
                "confirmed", 0.5,
                "pending", "-0.1")), null);
        check("error map", map("error", "x"), null);
        check("list body", Arrays.asList("0.5", "-0.1"), null);
        check("null body", null, null);
    }

    private static void check(String name, Object body, List<String> expected) {
        List<String> actual = ActivityCheckResponse.strings(
                body,
                "balances.confirmed",
                "balances.pending");
        if (expected == null ? actual != null : !expected.equals(actual)) {
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
