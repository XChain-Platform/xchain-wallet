// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.ui.TokenDetailRules;
import io.xchain.wallet.android.wear.ui.TokenDetailRules.State;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TokenDetailRulesCheck {
    private static final String CACHED_TOKEN_ID = "bitcoin-mainnet:XC";

    private TokenDetailRulesCheck() {}

    public static void main(String[] args) {
        checkHasContentInputs();

        boolean cachedContent = TokenDetailRules.hasContent(
                "+4.75% over 24 h",
                "XChain DEX",
                "A cached token used to verify that watch detail screens render phone-formatted facts and descriptions.",
                "xc-artwork-cache",
                5,
                0);
        boolean noArtworkContent = TokenDetailRules.hasContent(
                "+4.75% over 24 h",
                "XChain DEX",
                "A cached token used to verify that watch detail screens render phone-formatted facts and descriptions.",
                null,
                5,
                0);
        boolean nativeContent = TokenDetailRules.hasContent(
                "-6.25% over 24 h", "CoinGecko", null, null, 0, 48);
        boolean loadErrorContent = TokenDetailRules.hasContent(
                null, null, null, null, 0, 0);

        checkDetailState("detail-cached reachable", CACHED_TOKEN_ID, cachedContent, true, State.FULL);
        checkDetailState("detail-cached away", CACHED_TOKEN_ID, cachedContent, false, State.FULL);
        checkDetailState("detail-noart reachable", CACHED_TOKEN_ID, noArtworkContent, true, State.FULL);
        checkDetailState("detail-noart away", CACHED_TOKEN_ID, noArtworkContent, false, State.FULL);
        checkDetailState("detail-native reachable", "bitcoin-mainnet:BTC", nativeContent, true, State.FULL);
        checkDetailState("detail-native away", "bitcoin-mainnet:BTC", nativeContent, false, State.FULL);
        checkDetailState(
                "detail-loaderror reachable",
                "bitcoin-mainnet:LOADERROR",
                loadErrorContent,
                true,
                State.UNAVAILABLE);
        checkDetailState(
                "detail-loaderror away",
                "bitcoin-mainnet:LOADERROR",
                loadErrorContent,
                false,
                State.UNAVAILABLE);

        checkState("no detail reachable", CACHED_TOKEN_ID, null, cachedContent, true, State.WAITING);
        checkState(
                "no detail away",
                CACHED_TOKEN_ID,
                null,
                cachedContent,
                false,
                State.AWAY_NOT_CACHED);
        checkState(
                "different row reachable",
                "bitcoin-mainnet:OTHER",
                CACHED_TOKEN_ID,
                cachedContent,
                true,
                State.WAITING);
        checkState(
                "different row away",
                "bitcoin-mainnet:OTHER",
                CACHED_TOKEN_ID,
                cachedContent,
                false,
                State.AWAY_NOT_CACHED);

        checkEquals(
                "away notice key",
                "w2.moreDetails",
                TokenDetailRules.noticeKey(State.AWAY_NOT_CACHED));
        checkEquals(
                "unavailable notice key",
                "w2.detailsUnavailable",
                TokenDetailRules.noticeKey(State.UNAVAILABLE));
        checkEquals("full notice key", null, TokenDetailRules.noticeKey(State.FULL));
        checkEquals("waiting notice key", null, TokenDetailRules.noticeKey(State.WAITING));

        String contract = readText("packages/core/src/watch/contract/strings-balances.json");
        checkContractKey(contract, TokenDetailRules.noticeKey(State.AWAY_NOT_CACHED));
        checkContractKey(contract, TokenDetailRules.noticeKey(State.UNAVAILABLE));
        checkLoadErrorKeys();

        check(
                TokenDetailRules.showsArtworkImage("xc-artwork-cache", true),
                "cached artwork image shows");
        check(
                !TokenDetailRules.showsArtworkImage("xc-artwork-cache", false),
                "uncached artwork image does not show");
        check(
                !TokenDetailRules.showsArtworkImage("", true),
                "empty artwork hash does not show");
        check(
                !TokenDetailRules.showsArtworkImage(null, true),
                "null artwork hash does not show");
    }

    private static void checkHasContentInputs() {
        check(
                !TokenDetailRules.hasContent(null, null, null, null, 0, 0),
                "all-null content is empty");
        check(
                !TokenDetailRules.hasContent("", "", "", "", 0, 0),
                "all-empty content is empty");
        check(
                TokenDetailRules.hasContent("change", null, null, null, 0, 0),
                "change text is content");
        check(
                TokenDetailRules.hasContent(null, "source", null, null, 0, 0),
                "price source text is content");
        check(
                TokenDetailRules.hasContent(null, null, "description", null, 0, 0),
                "description is content");
        check(
                TokenDetailRules.hasContent(null, null, null, "hash", 0, 0),
                "artwork hash is content");
        check(
                TokenDetailRules.hasContent(null, null, null, null, 1, 0),
                "fact is content");
        check(
                TokenDetailRules.hasContent(null, null, null, null, 0, 1),
                "chart point is content");
    }

    private static void checkDetailState(
            String name,
            String tokenId,
            boolean hasContent,
            boolean phoneReachable,
            State expected) {
        checkState(name, tokenId, tokenId, hasContent, phoneReachable, expected);
    }

    private static void checkState(
            String name,
            String rowId,
            String detailTokenId,
            boolean hasContent,
            boolean phoneReachable,
            State expected) {
        checkEquals(
                name,
                expected,
                TokenDetailRules.state(rowId, detailTokenId, hasContent, phoneReachable));
    }

    private static void checkContractKey(String contract, String key) {
        check(contract.contains("\"" + key + "\""), "contract key " + key);
    }

    private static void checkLoadErrorKeys() {
        String fixture = readText("test/fixtures/watch/detail-loaderror.json");
        Matcher matcher = Pattern.compile("\"([^\"]+)\"\\s*:").matcher(fixture);
        List<String> keys = new ArrayList<>();
        while (matcher.find()) {
            keys.add(matcher.group(1));
        }
        checkEquals("detail-loaderror keys", Arrays.asList("v", "tokenId"), keys);
    }

    private static String readText(String path) {
        try {
            return Files.readString(Path.of(path));
        } catch (IOException error) {
            fail("read " + path + ": " + error.getMessage());
            return "";
        }
    }

    private static void checkEquals(String name, Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            fail(name + ": expected " + expected + ", got " + actual);
        }
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("TokenDetailRulesCheck failed: " + name);
        System.exit(1);
    }
}
