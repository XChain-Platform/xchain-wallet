// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);

function networkOf(chainId) {
    const segment = typeof chainId === 'string' ? chainId.split('-').at(-1) : null;
    return NETWORKS.has(segment) ? segment : null;
}

/**
 * Check whether multipart FILE actions are active for a chain.
 *
 * @param {{ chainId: string,
 *           tip: { blockTime?: number | null, protocolTime?: number | null } | null,
 *           activationTimes: Record<string, number | 'UNARMED'> }} params
 * @returns {boolean}
 */
export function isMultipartActive({ chainId, tip, activationTimes }) {
    const network = networkOf(chainId);
    const activationTime = network ? activationTimes?.[network] : undefined;
    if (!Number.isFinite(activationTime)) return false;
    if (activationTime === 0) return true;
    return Number.isFinite(tip?.protocolTime) && tip.protocolTime >= activationTime;
}

/**
 * Refuse multipart FILE actions before their network activation time.
 *
 * @param {{ chainId: string,
 *           tip: { blockTime?: number | null, protocolTime?: number | null } | null,
 *           activationTimes: Record<string, number | 'UNARMED'> }} params
 */
export function assertMultipartActive(params) {
    if (isMultipartActive(params)) return;
    const err = new Error('Multipart file uploads are not active on this network.');
    err.name = 'MultipartNotActiveError';
    err.code = 'MULTIPART_NOT_ACTIVE';
    throw err;
}
