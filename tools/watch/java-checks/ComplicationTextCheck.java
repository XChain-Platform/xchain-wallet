import io.xchain.wallet.android.wear.complication.ComplicationText;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

public final class ComplicationTextCheck {
    private static final Path STRING_SURFACES =
            Path.of("packages/core/src/watch/contract/strings-surfaces.json");
    private static final Path ANDROID_STRINGS =
            Path.of("packages/mobile/android/wear/src/main/res/values/strings.xml");

    private ComplicationTextCheck() {
    }

    public static void main(String[] args) throws IOException {
        ComplicationText.Content total = ComplicationText.shortText("$1,234.56", 5);
        check(total.kind == ComplicationText.Kind.TOTAL, "total kind");
        check("$1,234.56".equals(total.text), "total text");
        check("g2.balances".equals(total.titleKey), "total title key");
        check("g2_balances".equals(total.titleResource), "total title resource");

        ComplicationText.Content nullTotal = ComplicationText.shortText(null, 5);
        checkAlert(nullTotal, "5", "null total");

        ComplicationText.Content emptyTotal = ComplicationText.shortText("", 5);
        checkAlert(emptyTotal, "5", "empty total");

        check("0".equals(ComplicationText.shortText(null, 0).text), "zero unread count");
        check("0".equals(ComplicationText.shortText(null, -1).text), "negative unread count");

        String surfaces = Files.readString(STRING_SURFACES, StandardCharsets.UTF_8);
        check(hasJsonKey(surfaces, "g2.balances"), "g2.balances contract key");
        check(hasJsonKey(surfaces, "g2.alerts"), "g2.alerts contract key");

        String resources = Files.readString(ANDROID_STRINGS, StandardCharsets.UTF_8);
        check(resources.contains("name=\"g2_balances\""), "g2_balances Android resource");
        check(resources.contains("name=\"g2_alerts\""), "g2_alerts Android resource");

        ComplicationText.Content equalTotal = ComplicationText.shortText("$1,234.56", 5);
        check(total.equals(equalTotal), "equal content equality");
        check(total.hashCode() == equalTotal.hashCode(), "equal content hash code");
    }

    private static void checkAlert(
            ComplicationText.Content content,
            String expectedText,
            String caseName) {
        check(content.kind == ComplicationText.Kind.ALERTS, caseName + " kind");
        check(expectedText.equals(content.text), caseName + " text");
        check("g2.alerts".equals(content.titleKey), caseName + " title key");
        check("g2_alerts".equals(content.titleResource), caseName + " title resource");
    }

    private static boolean hasJsonKey(String json, String key) {
        return Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:").matcher(json).find();
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            System.err.println("ComplicationTextCheck failed: " + caseName);
            System.exit(1);
        }
    }
}
