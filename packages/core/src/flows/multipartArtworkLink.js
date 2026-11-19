// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const ACTION_INDEX = /^[1-9]\d*$/;

export function artworkLinkFields({ linkTarget, resolved, coinTicker, tick }) {
    if (linkTarget == null) {
        return { ok: false, reason: 'no_link_target' };
    }
    if (String(linkTarget.tick).toUpperCase() !== String(tick).toUpperCase()) {
        return { ok: false, reason: 'token_mismatch' };
    }
    if (resolved?.ready !== true) {
        return { ok: false, reason: resolved?.reason };
    }

    const coin1ActionIndex = String(resolved.actionIndex);
    const coin2ActionIndex = String(linkTarget.issueActionIndex);
    if (!ACTION_INDEX.test(coin1ActionIndex) || !ACTION_INDEX.test(coin2ActionIndex)) {
        return { ok: false, reason: 'bad_index' };
    }

    const coin = String(coinTicker).toUpperCase();
    return {
        ok: true,
        fields: {
            coin1: coin,
            coin1ActionIndex,
            coin2: coin,
            coin2ActionIndex,
        },
    };
}
