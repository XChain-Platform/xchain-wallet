// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Source-address resolution for auto-pay. The consent names a wallet and an
// address string, but the same string can sit in several wallets (a seed
// restored twice, a key imported twice, a watch-only copy). The record that
// signs must be the one the consent's wallet owns and that a software signer
// can sign for; anything else is refused before a hold is taken.

import { addressBelongsToWallet } from '../flows/exportPrivateKey.js';
import { isDeviceAddressSource } from '../schemas/constants.js';

const SOFTWARE_SOURCES = new Set(['hd', 'imported-wif']);

/**
 * @param {Object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {{ chainIdFor: Function }} opts.chainRegistry
 * @param {{ walletId: string, sourceAddress: string }} opts.consent
 * @param {string} opts.chainId
 * @returns {Promise<{ record: object } | { record: null, reason: 'source-missing' | 'source-ambiguous' | 'hardware-source' | 'unsignable-source' }>}
 */
export async function resolveAutopaySource({ vault, chainRegistry, consent, chainId }) {
    let owned = [];
    try {
        const wallet = await vault.wallets.get(consent.walletId);
        if (wallet) {
            const all = await vault.addresses.list();
            const named = all.filter((a) =>
                a.address === consent.sourceAddress &&
                chainRegistry.chainIdFor(a.chain, a.network) === chainId);
            for (const a of named) {
                if (await addressBelongsToWallet(vault, a, wallet)) owned.push(a);
            }
        }
    } catch {
        owned = [];
    }
    const signable = owned.filter((a) => a.source !== 'watch-only');
    if (signable.length === 0) return { record: null, reason: 'source-missing' };
    if (signable.length > 1) return { record: null, reason: 'source-ambiguous' };
    const record = signable[0];
    if (SOFTWARE_SOURCES.has(record.source)) return { record };
    return {
        record: null,
        reason: isDeviceAddressSource(record.source) ? 'hardware-source' : 'unsignable-source',
    };
}

