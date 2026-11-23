import io.xchain.wallet.android.wear.ui.AlertFamilyIcon;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class AlertFamilyIconCheck {
    private static final Path KINDS_PATH =
            Path.of("packages/core/src/watch/contract/kinds.json");
    private static final Path INBOX_SCHEMA_PATH =
            Path.of("packages/core/src/watch/contract/inbox.schema.json");
    private static final Pattern KIND_ENTRY = Pattern.compile(
            "\\\"([^\\\"]+)\\\"\\s*:\\s*\\{\\s*\\\"icon\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final Pattern FAMILY_ENUM = Pattern.compile(
            "\\\"family\\\"\\s*:\\s*\\{.*?\\\"enum\\\"\\s*:\\s*\\[(.*?)]",
            Pattern.DOTALL);
    private static final Pattern JSON_STRING = Pattern.compile("\\\"([^\\\"]+)\\\"");
    private static final Pattern DRAWABLE_NAME = Pattern.compile("[a-z][a-z0-9_]*");

    private AlertFamilyIconCheck() {}

    public static void main(String[] args) {
        try {
            Map<String, String> contractIcons = readContractIcons();
            checkKindsCoverage(contractIcons);
            checkSchemaCoverage(readSchemaFamilies());
            checkSpecifiedFamilies();
            checkFallbacks();
            checkDrawableNames();
            checkUnmodifiable();
            System.out.println("AlertFamilyIconCheck: all specified cases passed");
        } catch (IOException error) {
            fail("read contract JSON: " + error.getMessage());
        }
    }

    private static Map<String, String> readContractIcons() throws IOException {
        String json = Files.readString(KINDS_PATH, StandardCharsets.UTF_8);
        Map<String, String> icons = new LinkedHashMap<>();
        Matcher entries = KIND_ENTRY.matcher(json);
        while (entries.find()) {
            icons.put(entries.group(1), entries.group(2));
        }
        require(!icons.isEmpty(), "kinds.json contains family icon entries");
        return icons;
    }

    private static Set<String> readSchemaFamilies() throws IOException {
        String json = Files.readString(INBOX_SCHEMA_PATH, StandardCharsets.UTF_8);
        Matcher familyEnum = FAMILY_ENUM.matcher(json);
        require(familyEnum.find(), "inbox schema contains a family enum");

        Set<String> families = new LinkedHashSet<>();
        Matcher values = JSON_STRING.matcher(familyEnum.group(1));
        while (values.find()) {
            families.add(values.group(1));
        }
        require(!families.isEmpty(), "inbox schema family enum is not empty");
        return families;
    }

    private static void checkKindsCoverage(Map<String, String> contractIcons) {
        for (Map.Entry<String, String> entry : contractIcons.entrySet()) {
            require(entry.getValue().equals(AlertFamilyIcon.PHONE_ICONS.get(entry.getKey())),
                    "PHONE_ICONS matches kinds.json for " + entry.getKey());
        }
        for (String family : AlertFamilyIcon.PHONE_ICONS.keySet()) {
            require(contractIcons.containsKey(family),
                    "PHONE_ICONS has no family absent from kinds.json: " + family);
        }
    }

    private static void checkSchemaCoverage(Set<String> schemaFamilies) {
        for (String family : schemaFamilies) {
            require(AlertFamilyIcon.PHONE_ICONS.containsKey(family),
                    "PHONE_ICONS contains inbox schema family " + family);
        }
    }

    private static void checkSpecifiedFamilies() {
        require("DocumentIcon".equals(AlertFamilyIcon.phoneIcon("request")),
                "request uses DocumentIcon");
        require("ic_family_document".equals(AlertFamilyIcon.drawableName("request")),
                "request uses ic_family_document");
        require("ClockIcon".equals(AlertFamilyIcon.phoneIcon("paydue")),
                "paydue uses ClockIcon");
        require("ic_family_clock".equals(AlertFamilyIcon.drawableName("paydue")),
                "paydue uses ic_family_clock");
        require("ic_family_line_chart".equals(AlertFamilyIcon.drawableName("orderFills")),
                "orderFills uses ic_family_line_chart");
    }

    private static void checkFallbacks() {
        checkFallback(null, "null");
        checkFallback("", "empty family");
        checkFallback("TxConfirmations", "case-mismatched family");
        checkFallback("unknownFamily", "unknown family");
    }

    private static void checkFallback(String family, String caseName) {
        require("BellIcon".equals(AlertFamilyIcon.phoneIcon(family)),
                caseName + " uses BellIcon");
        require("ic_family_bell".equals(AlertFamilyIcon.drawableName(family)),
                caseName + " uses ic_family_bell");
    }

    private static void checkDrawableNames() {
        for (String family : AlertFamilyIcon.PHONE_ICONS.keySet()) {
            String drawableName = AlertFamilyIcon.drawableName(family);
            require(DRAWABLE_NAME.matcher(drawableName).matches(),
                    "drawable name is resource-safe for " + family + ": " + drawableName);
        }
        require(DRAWABLE_NAME.matcher(AlertFamilyIcon.drawableName(null)).matches(),
                "fallback drawable name is resource-safe");
    }

    private static void checkUnmodifiable() {
        try {
            AlertFamilyIcon.PHONE_ICONS.put("other", "BellIcon");
            fail("PHONE_ICONS rejects put");
        } catch (UnsupportedOperationException expected) {
            require(true, "PHONE_ICONS rejects put");
        }
    }

    private static void require(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("AlertFamilyIconCheck failed: " + caseName);
        System.exit(1);
    }
}
