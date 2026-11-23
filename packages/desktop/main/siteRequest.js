// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { URI_MAX_LENGTH } from '@xchain-wallet/core/uri/bip21.js';
import { isLocalhostOrigin } from '@xchain-wallet/core/shared/utils/originAutoApprove.js';

import { allowlistedExternalUrl } from './security.js';

/**
 * @param {unknown} url
 * @param {{ developerMode?: boolean, maxLength?: number }} [options]
 * @returns {string | null}
 */
export function siteReturnTarget(
    url,
    { developerMode = false, maxLength = URI_MAX_LENGTH } = {},
) {
    if (typeof url !== 'string' || url.length === 0) return null;
    if (!Number.isFinite(maxLength) || maxLength < 0 || url.length > maxLength) return null;

    const href = allowlistedExternalUrl(url);
    if (href === null || href.length > maxLength) return null;

    const parsed = new URL(href);
    if (parsed.protocol === 'http:') {
        if (developerMode !== true || !isLocalhostOrigin(href)) return null;
    } else if (parsed.protocol !== 'https:') {
        return null;
    }

    const fragmentIndex = href.indexOf('#');
    const targetLength = fragmentIndex === -1 ? href.length : fragmentIndex;
    if (targetLength > 2_048) return null;
    if (fragmentIndex !== -1 && !/^#xchain=[A-Za-z0-9_-]+$/.test(href.slice(fragmentIndex))) {
        return null;
    }

    return href;
}
