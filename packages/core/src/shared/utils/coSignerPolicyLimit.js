// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/coSigner.js';
import '../../i18n/locales/en/send.js';
import { allowedTicksMode, normalizeAllowedTicks } from '../../cosigner/allowedTicks.js';

/**
 * Words for an agent account policy field left unset, which is unrestricted;
 * null when the field carries a value to show exactly.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function policyNoLimitText(value) {
    return value == null ? t('coSigner.provision.noLimit') : null;
}

/**
 * The Allowed tokens rule in words: Any token, None, or the listed tickers.
 *
 * @param {{ allowedTicks?: unknown } | null | undefined} policy
 * @returns {string}
 */
export function allowedTokensText(policy) {
    const mode = allowedTicksMode(policy);
    if (mode === 'any') return t('coSigner.policy.tokens.any');
    if (mode === 'none') return t('send.advanced.none');
    return normalizeAllowedTicks(policy.allowedTicks).join(', ');
}

/**
 * The network an agent account lives on, as the account screens name it:
 * "Bitcoin" on mainnet, "Bitcoin Testnet" or "Bitcoin Regtest" elsewhere.
 *
 * @param {{ displayName?: string, coin?: string, networkKind?: string } | null | undefined} descriptor
 * @returns {string}
 */
export function agentNetworkName(descriptor) {
    if (!descriptor) return '';
    const base = descriptor.displayName || String(descriptor.coin || '');
    const kind = String(descriptor.networkKind || '');
    if (!kind || kind === 'mainnet') return base;
    return `${base} ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}
