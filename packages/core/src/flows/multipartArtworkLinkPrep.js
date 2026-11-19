// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveMultipartLinkTarget } from './multipartLinkTarget.js';
import { artworkLinkFields } from './multipartArtworkLink.js';

const TXID = /^[0-9a-f]{64}$/;

function invalid(field) {
    const error = new TypeError(`Invalid ${field}`);
    error.code = 'ARTWORK_LINK_PREP_INVALID';
    throw error;
}

function validate({ explorer, txid, tick, coinTicker }) {
    if (typeof txid !== 'string' || !TXID.test(txid)) invalid('txid');
    if (typeof explorer?.getTransaction !== 'function'
        || typeof explorer?.getAction !== 'function') invalid('explorer');
    if (typeof tick !== 'string' || tick.trim() === '') invalid('tick');
    if (typeof coinTicker !== 'string' || coinTicker.trim() === '') invalid('coinTicker');
}

export async function prepareArtworkLink({
    explorer,
    txid,
    linkTarget,
    tick,
    coinTicker,
    maxAttempts,
    waitMs,
    sleep,
}) {
    validate({ explorer, txid, tick, coinTicker });
    const wrongTarget = linkTarget == null
        || String(linkTarget.tick).toUpperCase() !== tick.toUpperCase();
    if (wrongTarget) {
        return artworkLinkFields({ linkTarget, resolved: null, coinTicker, tick });
    }
    const resolved = await resolveMultipartLinkTarget({
        explorer, txid, maxAttempts, waitMs, sleep,
    });
    return artworkLinkFields({ linkTarget, resolved, coinTicker, tick });
}
