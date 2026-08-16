// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// multisigAddress: Phase 4 Step 18 wrapper. Reads the persisted
// MultisigConfig off a Wallet record, dispatches to
// `sdk.deriveMultisigAddress` (xchain-sdk 1.11+), and returns the
// rendered multisig address along with metadata the Receive surface
// needs (N-of-M label, scheme tag, cosigner names).
//
// Pure read: no signing, no PSBT construction. The wallet.multisig
// field is the source of truth for the address computation: the
// scriptTemplate persisted at MultisigConfig creation time (Step 17)
// drives the address render here.
//
// chainId selects the network for address encoding (bech32 prefix
// for P2WSH/P2TR; version bytes for P2SH base58check). Multisig is
// BTC-only at launch per §22 + §10.3.

/**
 * @typedef {Object} ReceiveMultisigAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} [multisigConfigId]    optional; defaults to the first config in `wallet.multisigs`
 */

/**
 * @typedef {Object} ReceiveMultisigAddressResult
 * @property {string} address
 * @property {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} scheme
 * @property {number} threshold
 * @property {number} cosignerCount
 * @property {string[]} cosignerNames
 * @property {string} schemeLabel              human-readable: "2-of-3 SegWit multi-signature (lower fees)"
 * @property {string | null} redeemScript      hex; populated for p2sh-multisig
 * @property {string | null} witnessScript     hex; populated for p2wsh-multisig
 * @property {string | null} outputPubkey      hex; populated for taproot-musig2
 */

/**
 * @param {ReceiveMultisigAddressOpts} opts
 * @returns {Promise<ReceiveMultisigAddressResult>}
 */
export async function receiveMultisigAddress(opts) {
    if (!opts) throw new Error('receiveMultisigAddress: opts is required');
    if (!opts.vault) throw new Error('receiveMultisigAddress: vault is required');
    if (!opts.sdkRegistry) throw new Error('receiveMultisigAddress: sdkRegistry is required');
    if (typeof opts.walletId !== 'string' || opts.walletId.length === 0) {
        throw new Error('receiveMultisigAddress: walletId is required');
    }
    if (typeof opts.chainId !== 'string' || opts.chainId.length === 0) {
        throw new Error('receiveMultisigAddress: chainId is required');
    }

    const wallet = await opts.vault.wallets.get(opts.walletId);
    if (!wallet) {
        throw new Error(`receiveMultisigAddress: wallet "${opts.walletId}" not found`);
    }
    const configs = Array.isArray(wallet.multisigs) ? wallet.multisigs : [];
    let config;
    if (typeof opts.multisigConfigId === 'string' && opts.multisigConfigId.length > 0) {
        config = configs.find((c) => c.id === opts.multisigConfigId);
        if (!config) {
            throw new Error(
                `receiveMultisigAddress: wallet "${opts.walletId}" has no multisig config with id "${opts.multisigConfigId}"`,
            );
        }
    } else {
        config = configs[0];
    }
    if (!config) {
        throw new Error(
            `receiveMultisigAddress: wallet "${opts.walletId}" has no multisig configuration. Run the §22 coordinator first`,
        );
    }

    const sdk = opts.sdkRegistry.get(opts.chainId);
    if (!sdk) {
        throw new Error(`receiveMultisigAddress: no SDK registered for chainId "${opts.chainId}"`);
    }
    if (typeof sdk.deriveMultisigAddress !== 'function') {
        throw new Error(
            'receiveMultisigAddress: sdk.deriveMultisigAddress is unavailable. Bump xchain-sdk to ^1.11.0',
        );
    }

    const derived = sdk.deriveMultisigAddress({
        scriptTemplate: config.scriptTemplate,
        scheme: config.scheme,
    });
    if (!derived || typeof derived.address !== 'string' || derived.address.length === 0) {
        throw new Error('receiveMultisigAddress: SDK returned no address');
    }

    return {
        multisigConfigId: config.id,
        address:        derived.address,
        scheme:         config.scheme,
        threshold:      config.threshold,
        cosignerCount:  config.cosigners.length,
        cosignerNames:  config.cosigners.map((c) => c.name),
        schemeLabel:    formatSchemeLabel(config),
        redeemScript:   derived.redeemScript || null,
        witnessScript:  derived.witnessScript || null,
        outputPubkey:   derived.outputPubkey || null,
    };
}

/**
 * §56.3 pre-launch Step 4 plural variant: render every multisig
 * receive address the wallet has configured for the given chain.
 * Returns an array (possibly empty); each entry mirrors the
 * single-config `receiveMultisigAddress` return shape.
 *
 * @param {{ vault: any, sdkRegistry: any, walletId: string, chainId: string }} opts
 * @returns {Promise<Array<ReceiveMultisigAddressResult>>}
 */
export async function listMultisigReceiveAddresses(opts) {
    if (!opts) throw new Error('listMultisigReceiveAddresses: opts is required');
    if (!opts.vault) throw new Error('listMultisigReceiveAddresses: vault is required');
    if (!opts.sdkRegistry) throw new Error('listMultisigReceiveAddresses: sdkRegistry is required');
    if (typeof opts.walletId !== 'string' || opts.walletId.length === 0) {
        throw new Error('listMultisigReceiveAddresses: walletId is required');
    }
    if (typeof opts.chainId !== 'string' || opts.chainId.length === 0) {
        throw new Error('listMultisigReceiveAddresses: chainId is required');
    }
    const wallet = await opts.vault.wallets.get(opts.walletId);
    if (!wallet) return [];
    const configs = Array.isArray(wallet.multisigs) ? wallet.multisigs : [];
    const out = [];
    for (const c of configs) {
        try {
            const r = await receiveMultisigAddress({
                vault: opts.vault,
                sdkRegistry: opts.sdkRegistry,
                walletId: opts.walletId,
                chainId: opts.chainId,
                multisigConfigId: c.id,
            });
            out.push(r);
        } catch {
            // A misconfigured config shouldn't blow up the whole list; skip it.
        }
    }
    return out;
}

function formatSchemeLabel(config) {
    const t = config.threshold;
    const n = config.cosigners.length;
    if (config.scheme === 'p2sh-multisig') return `${t}-of-${n} Classic multi-signature`;
    if (config.scheme === 'p2wsh-multisig') return `${t}-of-${n} SegWit multi-signature (lower fees)`;
    return `${t}-of-${n} Taproot multi-signature (looks like a single-key address)`;
}
