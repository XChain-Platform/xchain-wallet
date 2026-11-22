// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.ui.TokenGlyph;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TokenGlyphCheck {
    private static final double EPSILON = 1e-9;

    private TokenGlyphCheck() {}

    public static void main(String[] args) {
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));
        checkLetter("xcp", "X");
        checkLetter("A", "A");
        checkLetter("ixp", "I");
        checkLetter("", "?");
        checkLetter(null, "?");

        double[] color = TokenGlyph.rgb("#1A74A8");
        check(color != null, "#1A74A8 parses");
        checkClose(color[0], 26.0 / 255.0, "#1A74A8 red");
        checkClose(color[1], 116.0 / 255.0, "#1A74A8 green");
        checkClose(color[2], 168.0 / 255.0, "#1A74A8 blue");
        check(color != TokenGlyph.rgb("#1A74A8"), "rgb returns a new array");

        checkInvalidColor("#1a74a8");
        checkInvalidColor("#FFF");
        checkInvalidColor("1A74A8");
        checkInvalidColor("#1A74A8FF");
        checkInvalidColor("#GGGGGG");
        checkInvalidColor("");
        checkInvalidColor(null);

        List<String> palette = readPalette();
        check(palette.size() >= 15, "AssetMark PALETTE has at least 15 colors");
        for (String hex : palette) {
            check(TokenGlyph.rgb(hex) != null, "AssetMark PALETTE color parses: " + hex);
        }
    }

    private static void checkLetter(String tick, String expected) {
        check(expected.equals(TokenGlyph.letter(tick)), "letter(" + tick + ") is " + expected);
    }

    private static void checkInvalidColor(String hex) {
        check(TokenGlyph.rgb(hex) == null, "invalid color returns null: " + hex);
    }

    private static void checkClose(double actual, double expected, String name) {
        check(Math.abs(actual - expected) <= EPSILON, name);
    }

    private static List<String> readPalette() {
        String source;
        try {
            source = Files.readString(Path.of("packages/core/src/ui/AssetMark.jsx"));
        } catch (IOException error) {
            fail("read AssetMark PALETTE: " + error.getMessage());
            return List.of();
        }

        Matcher declaration = Pattern.compile("const\\s+PALETTE\\s*=\\s*\\[(.*?)]", Pattern.DOTALL)
                .matcher(source);
        check(declaration.find(), "AssetMark PALETTE declaration exists");

        List<String> colors = new ArrayList<>();
        Matcher color = Pattern.compile("#[0-9A-Za-z]+").matcher(declaration.group(1));
        while (color.find()) {
            colors.add(color.group());
        }
        return colors;
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("TokenGlyphCheck failed: " + name);
        System.exit(1);
    }
}
