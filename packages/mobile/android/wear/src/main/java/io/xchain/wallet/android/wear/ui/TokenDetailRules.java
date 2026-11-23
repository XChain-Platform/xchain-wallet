// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui;

import java.util.Objects;

public final class TokenDetailRules {
    public enum State {
        FULL,
        UNAVAILABLE,
        AWAY_NOT_CACHED,
        WAITING,
    }

    private TokenDetailRules() {}

    public static boolean hasContent(
            String changeText,
            String priceSourceText,
            String description,
            String artworkHash,
            int factCount,
            int chartPointCount) {
        return hasText(changeText)
                || hasText(priceSourceText)
                || hasText(description)
                || hasText(artworkHash)
                || factCount > 0
                || chartPointCount > 0;
    }

    public static State state(
            String rowId,
            String detailTokenId,
            boolean detailHasContent,
            boolean phoneReachable) {
        if (detailTokenId == null || !Objects.equals(detailTokenId, rowId)) {
            return phoneReachable ? State.WAITING : State.AWAY_NOT_CACHED;
        }
        return detailHasContent ? State.FULL : State.UNAVAILABLE;
    }

    public static String noticeKey(State state) {
        if (state == State.AWAY_NOT_CACHED) {
            return "w2.moreDetails";
        }
        if (state == State.UNAVAILABLE) {
            return "w2.detailsUnavailable";
        }
        return null;
    }

    public static boolean showsArtworkImage(String artworkHash, boolean imageCached) {
        return hasText(artworkHash) && imageCached;
    }

    private static boolean hasText(String text) {
        return text != null && !text.isEmpty();
    }
}
