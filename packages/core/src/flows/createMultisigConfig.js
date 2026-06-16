// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// createMultisigConfig — §22 + §42.9 wallet-creation coordinator core
// flow. Step 17 of Phase 4. Takes a list of cosigners (one local +
// N-1 external) plus a scheme + threshold, computes the
// scriptTemplate (delegating to xchain-sdk's MuSig2 primitives for
// taproot-musig2), and persists the resulting MultisigConfig onto
// the chosen Wallet record's `multisig` slot (§11.3.6).
//
// This flow is platform-agnostic — no encoding, no signing, no PSBT
// construction. Address derivation (Step 18), PSBT construction
// (Step 19), QR transport (Step 20), HW MuSig2 wiring (Step 21) and
// surface-wide badging (Step 22) all build on the persisted
// MultisigConfig this flow writes.

import { buildMultisigConfig } from '../schemas/multisigConfig.js';

/**
 * @typedef {Object} CosignerInput
 * @property {string} name
 * @property {string} pubkey                              compressed pubkey hex (66 chars)
 * @property {string} fingerprint                         BIP32 master fingerprint, hex (8 chars)
 * @property {'local' | 'external-xpub' | 'external-hardware'} origin
 * @property {string | null} [localSignerId]              required when origin='local'
 * @property {string | null} [xpub]                       required when origin='external-xpub'
 * @property {string} derivationPath                      e.g. "m/48'/0'/0'/2'/0/0"
 */

/**
 * @typedef {Object} CreateMultisigConfigOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId                             must be a BTC chainId (multisig is BTC-only at launch per §10.3)
 * @property {string} walletId                            target Wallet record (gets the .multisig field set)
 * @property {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} scheme
 * @property {number} threshold                           1 ≤ threshold ≤ cosigners.length
 * @property {CosignerInput[]} cosigners
 */

/**
 * @param {CreateMultisigConfigOpts} opts
 * @returns {Promise<{ wallet: any, config: import('../schemas/multisigConfig.js').MultisigConfig }>}
 */
export async function createMultisigConfig(opts) {
    if (!opts) throw new Error('createMultisigConfig: opts is required');
    if (!opts.vault) throw new Error('createMultisigConfig: vault is required');
    if (!opts.sdkRegistry) throw new Error('createMultisigConfig: sdkRegistry is required');
    if (typeof opts.chainId !== 'string' || opts.chainId.length === 0) {
        throw new Error('createMultisigConfig: chainId is required');
    }
    if (typeof opts.walletId !== 'string' || opts.walletId.length === 0) {
        throw new Error('createMultisigConfig: walletId is required');
    }
    if (!opts.scheme) throw new Error('createMultisigConfig: scheme is required');
    if (!Number.isInteger(opts.threshold) || opts.threshold <= 0) {
        throw new Error('createMultisigConfig: threshold must be a positive integer');
    }
    if (!Array.isArray(opts.cosigners) || opts.cosigners.length < 2) {
        throw new Error('createMultisigConfig: cosigners must be an array of at least 2 entries');
    }
    if (opts.threshold > opts.cosigners.length) {
        throw new Error('createMultisigConfig: threshold must be ≤ cosigners.length');
    }
    // MuSig2 is n-of-n by construction: the single aggregated Schnorr signature
    // requires a nonce + partial sig from EVERY cosigner whose key is in the
    // key-agg context. A "T-of-N" taproot-musig2 with T<N derives an N-key
    // address but can never be signed by fewer than N — the funds would be
    // permanently unspendable. Real T-of-N belongs on p2wsh-multisig
    // (OP_CHECKMULTISIG). Reject early with an actionable error.
    if (opts.scheme === 'taproot-musig2' && opts.threshold !== opts.cosigners.length) {
        throw new Error(
            `createMultisigConfig: taproot-musig2 is n-of-n only — threshold (${opts.threshold}) ` +
            `must equal cosigners.length (${opts.cosigners.length}). ` +
            `For a true ${opts.threshold}-of-${opts.cosigners.length} policy use scheme "p2wsh-multisig".`,
        );
    }

    // Cosigner shape sanity — surface clear errors before we hit the
    // schema validator with a half-formed record.
    opts.cosigners.forEach((c, i) => {
        const tag = `cosigners[${i}]`;
        if (!c || typeof c !== 'object') throw new Error(`createMultisigConfig: ${tag} must be an object`);
        if (typeof c.name !== 'string' || c.name.length === 0) throw new Error(`createMultisigConfig: ${tag}.name is required`);
        if (typeof c.pubkey !== 'string' || !/^[0-9a-fA-F]+$/.test(c.pubkey)) throw new Error(`createMultisigConfig: ${tag}.pubkey must be hex`);
        if (typeof c.fingerprint !== 'string' || !/^[0-9a-fA-F]{8}$/.test(c.fingerprint)) throw new Error(`createMultisigConfig: ${tag}.fingerprint must be 8 hex chars`);
        if (!['local', 'external-xpub', 'external-hardware'].includes(c.origin)) throw new Error(`createMultisigConfig: ${tag}.origin must be local | external-xpub | external-hardware`);
        if (c.origin === 'local' && (typeof c.localSignerId !== 'string' || c.localSignerId.length === 0)) {
            throw new Error(`createMultisigConfig: ${tag}.localSignerId is required when origin='local'`);
        }
        if (c.origin === 'external-xpub' && (typeof c.xpub !== 'string' || c.xpub.length === 0)) {
            throw new Error(`createMultisigConfig: ${tag}.xpub is required when origin='external-xpub'`);
        }
        if (typeof c.derivationPath !== 'string' || c.derivationPath.length === 0) {
            throw new Error(`createMultisigConfig: ${tag}.derivationPath is required`);
        }
    });

    // For taproot-musig2 we aggregate keys via the SDK's BIP327 module
    // and stash the resulting x-only aggregate pubkey in the
    // scriptTemplate. P2SH/P2WSH skip this step — the redeem script is
    // computed from the cosigner pubkeys at PSBT-build time (Step 19).
    let aggregatedXOnlyPubkey;
    if (opts.scheme === 'taproot-musig2') {
        const sdk = opts.sdkRegistry.get(opts.chainId);
        if (!sdk) throw new Error(`createMultisigConfig: no SDK registered for chainId "${opts.chainId}"`);
        if (!sdk.musig2 || typeof sdk.musig2.aggregateKeys !== 'function') {
            throw new Error('createMultisigConfig: sdk.musig2.aggregateKeys is unavailable — bump xchain-sdk to 1.10+');
        }
        const pubkeyBytes = opts.cosigners.map((c) => hexToBytes(c.pubkey));
        const ctx = sdk.musig2.aggregateKeys(pubkeyBytes);
        if (!ctx || !(ctx.xOnlyPubkey instanceof Uint8Array)) {
            throw new Error('createMultisigConfig: musig2.aggregateKeys returned no xOnlyPubkey');
        }
        aggregatedXOnlyPubkey = bytesToHex(ctx.xOnlyPubkey);
    }

    const config = buildMultisigConfig({
        scheme: opts.scheme,
        threshold: opts.threshold,
        cosigners: opts.cosigners.map((c) => ({
            name: c.name,
            pubkey: c.pubkey.toLowerCase(),
            fingerprint: c.fingerprint.toLowerCase(),
            origin: c.origin,
            localSignerId: c.origin === 'local' ? (c.localSignerId || null) : null,
            xpub: c.origin === 'external-xpub' ? (c.xpub || null) : null,
            derivationPath: c.derivationPath,
        })),
        ...(aggregatedXOnlyPubkey ? { aggregatedXOnlyPubkey } : {}),
    });

    const existing = await opts.vault.wallets.get(opts.walletId);
    if (!existing) {
        throw new Error(`createMultisigConfig: wallet "${opts.walletId}" not found`);
    }
    const currentConfigs = Array.isArray(existing.multisigs) ? existing.multisigs : [];
    if (currentConfigs.some((c) => c.scriptTemplate === config.scriptTemplate)) {
        throw new Error(
            `createMultisigConfig: wallet "${opts.walletId}" already has a multisig configuration with this scriptTemplate; remove it before re-running this flow`,
        );
    }
    const next = { ...existing, multisigs: [...currentConfigs, config] };
    await opts.vault.wallets.put(next);
    return { wallet: next, config };
}

function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error('hexToBytes: odd-length hex string');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
