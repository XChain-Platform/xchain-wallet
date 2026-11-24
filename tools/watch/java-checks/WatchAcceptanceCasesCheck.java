// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.watch.WatchAcceptanceCases;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class WatchAcceptanceCasesCheck {
    private static final Path FIXTURES = Paths.get("test/fixtures/watch");

    private WatchAcceptanceCasesCheck() {
    }

    public static void main(String[] args) {
        List<String> expectedCases = Arrays.asList("balances", "alerts", "privacy");
        check("CASES order", expectedCases.equals(WatchAcceptanceCases.CASES));
        check("script case-name pattern", expectedCases.equals(scriptCases()));

        checkSends("balances", new String[][] {
                {"snapshot", "snapshot-rows50.json"},
                {"detail", "detail-native.json"},
                {"detail", "detail-cached.json"}
        });
        checkSends("alerts", new String[][] {});
        checkSends("privacy", new String[][] {
                {"snapshot", "snapshot-hidden.json"},
                {"snapshot", "snapshot-disabled.json"}
        });

        checkInvalid(null);
        checkInvalid("");
        checkInvalid("Balances");
        checkInvalid("tiles");

        checkUnmodifiable("CASES", WatchAcceptanceCases.CASES, "tiles");
        for (String caseName : expectedCases) {
            checkUnmodifiable(caseName + " sends", WatchAcceptanceCases.fixtureSends(caseName),
                    new WatchAcceptanceCases.Send("snapshot", "unused.json"));
        }

        System.out.println("WatchAcceptanceCasesCheck ok");
    }

    private static List<String> scriptCases() {
        Path script = Paths.get("packages/mobile/scripts/wear-acceptance.sh");
        String source;
        try {
            source = new String(Files.readAllBytes(script), StandardCharsets.UTF_8);
        } catch (IOException error) {
            fail("script case-name pattern: " + error.getMessage());
            return Arrays.asList();
        }

        Matcher matcher = Pattern.compile("\\^\\(([^)]+)\\)\\$").matcher(source);
        check("script case-name pattern present", matcher.find());
        return Arrays.asList(matcher.group(1).split("\\|", -1));
    }

    private static void checkSends(String caseName, String[][] expected) {
        List<WatchAcceptanceCases.Send> actual = WatchAcceptanceCases.fixtureSends(caseName);
        check(caseName + " send count", actual.size() == expected.length);
        for (int index = 0; index < expected.length; index++) {
            WatchAcceptanceCases.Send send = actual.get(index);
            check(caseName + " send " + index,
                    expected[index][0].equals(send.kind)
                            && expected[index][1].equals(send.asset));
            Path asset = Paths.get(send.asset);
            check(caseName + " asset " + send.asset,
                    asset.getNameCount() == 1 && Files.isRegularFile(FIXTURES.resolve(asset)));
        }
    }

    private static void checkInvalid(String caseName) {
        try {
            WatchAcceptanceCases.fixtureSends(caseName);
            fail("invalid case " + String.valueOf(caseName));
        } catch (IllegalArgumentException expected) {
            check("invalid case " + String.valueOf(caseName) + " named",
                    expected.getMessage() != null
                            && expected.getMessage().contains(String.valueOf(caseName)));
        }
    }

    private static <T> void checkUnmodifiable(String name, List<T> list, T value) {
        try {
            list.add(value);
            fail(name + " unmodifiable");
        } catch (UnsupportedOperationException expected) {
            return;
        }
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
