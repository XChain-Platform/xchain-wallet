// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// provisionCoSignerAccount (§22, P4 passive co-signer, provisioning).
//
// Create + persist a CoSignerAccount for a 2-of-2 MuSig2 agent account. The
// aggregate P2TR address is derived through the SDK (single source of truth
// for MuSig2 + network params: sdk.coSigner.deriveMuSig2P2TR); the wallet
// never re-implements the key aggregation.
//
// No unlock is needed: both the agent pubkey and this wallet's daemon pubkey
// are public. The caller (UI) picks a wallet address to act as the daemon
// key and passes its `publicKey` + `derivationPath`; the actual private key
// is only ever derived later, transiently, at co-sign time
// (see passiveCoSignForAccount).
//
// Key-aggregation order matters (MuSig2 keyAgg is order-sensitive), so the
// SAME order handed to deriveMuSig2P2TR is stored as `publicKeyOrder` and
// later handed to the co-signer. The agreed order is [agent, daemon].

import { createCoSignerAccount } from '../schemas/coSignerAccount.js';

/**
 * @typedef {Object} ProvisionCoSignerAccountOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} agentPubkey                 hex; the agent's (live signer) pubkey
 * @property {string} daemonPubkey                hex; this wallet's key in the group
 * @property {string} daemonDerivationPath        BIP32 path the daemon key derives from
 * @property {import('../schemas/coSignerAccount.js').CoSignerAccountPolicy} policy
 * @property {Array<{ address?: string, script?: string, maxValue?: number }>} [allowedOutputs]
 * @property {string} [name]
 */

/**
 * @param {ProvisionCoSignerAccountOpts} opts
 * @returns {Promise<import('../schemas/coSignerAccount.js').CoSignerAccount>}
 */
export async function provisionCoSignerAccount(opts = {}) {
    const {
        vault,
        sdkRegistry,
        walletId,
        chainId,
        agentPubkey,
        daemonPubkey,
        daemonDerivationPath,
        policy,
        allowedOutputs,
        name,
    } = opts;

    if (!vault || !vault.coSignerAccounts) throw new Error('provisionCoSignerAccount: vault is required');
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('provisionCoSignerAccount: sdkRegistry is required');
    }
    if (typeof walletId !== 'string' || walletId.length === 0) throw new Error('provisionCoSignerAccount: walletId is required');
    if (typeof chainId !== 'string' || chainId.length === 0) throw new Error('provisionCoSignerAccount: chainId is required');
    if (typeof agentPubkey !== 'string' || agentPubkey.length === 0) throw new Error('provisionCoSignerAccount: agentPubkey is required');
    if (typeof daemonPubkey !== 'string' || daemonPubkey.length === 0) throw new Error('provisionCoSignerAccount: daemonPubkey is required');
    if (typeof daemonDerivationPath !== 'string' || daemonDerivationPath.length === 0) {
        throw new Error('provisionCoSignerAccount: daemonDerivationPath is required');
    }
    if (!policy || !Array.isArray(policy.allowedActions) || policy.allowedActions.length === 0) {
        throw new Error('provisionCoSignerAccount: policy.allowedActions is required');
    }

    const sdk = sdkRegistry.get(chainId);
    if (!sdk || !sdk.coSigner || typeof sdk.coSigner.deriveMuSig2P2TR !== 'function') {
        throw new Error('provisionCoSignerAccount: SDK with sdk.coSigner.deriveMuSig2P2TR is required');
    }

    // Agreed key-aggregation order: [agent, daemon]. Stored and reused at
    // sign time so the co-signer aggregates the exact same key.
    const publicKeyOrder = [String(agentPubkey).toLowerCase(), String(daemonPubkey).toLowerCase()];

    const network = sdk.wallet && typeof sdk.wallet.getBitcoinNetwork === 'function'
        ? sdk.wallet.getBitcoinNetwork()
        : undefined;

    const derived = sdk.coSigner.deriveMuSig2P2TR(publicKeyOrder, network || undefined);
    if (!derived || typeof derived.address !== 'string' || derived.address.length === 0) {
        throw new Error('provisionCoSignerAccount: deriveMuSig2P2TR did not return an aggregate address');
    }

    const record = createCoSignerAccount({
        walletId,
        chainId,
        name,
        aggregateAddress: derived.address,
        agentPubkey,
        daemonPubkey,
        daemonDerivationPath,
        publicKeyOrder,
        policy,
        allowedOutputs,
    });

    await vault.coSignerAccounts.put(record);
    return record;
}
