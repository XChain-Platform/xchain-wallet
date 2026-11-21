// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isAssetImageSourceAllowed } from '../shared/components/BalanceList.jsx';

export const WATCH_IMAGE_GLYPH = Symbol('watch-image-glyph');

export async function fetchWatchImage({
    source,
    settings,
    fetchImpl = globalThis.fetch,
}) {
    const privacy = settings?.privacy;

    if (privacy?.metadataFetchEnabled !== true
        || privacy.torRouting
        || !isAssetImageSourceAllowed(source, true)
        || typeof fetchImpl !== 'function') {
        return WATCH_IMAGE_GLYPH;
    }

    try {
        const response = await fetchImpl(source, { mode: 'cors' });
        if (!response.ok) return WATCH_IMAGE_GLYPH;
        return await response.blob();
    } catch {
        return WATCH_IMAGE_GLYPH;
    }
}
