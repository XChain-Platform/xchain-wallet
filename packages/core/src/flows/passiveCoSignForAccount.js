// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// passiveCoSignForAccount (§22, P4 passive co-signer, slice 2b).
//
// The account-aware entry point: given a stored CoSignerAccount and an
// inbound request, it derives the daemon key, runs the policy co-sign
// decision, and returns the verdict. This is the layer that ties the
// persisted account (schema slice) to the pure passiveCoSign orchestration.
//
// Key handling (the one sensitive step): the SDK CoSigner needs the raw
// 32-byte daemon secret for deterministic partial-signing. We derive it
// TRANSIENTLY, mirroring exportPrivateKey / publishLabelsNow: unlock the
// wallet, export the WIF for the account's derivation path, decode it to
// the 32-byte key, hand it to the co-signer for exactly one process()
// call, and zero it in a finally. The raw key never persists and never
// outlives the request. `withUnlocked` guarantees the signer is locked on
// return.
//
// Ordering: the panic-mode freeze (§26.5) and the enabled flag are checked
// BEFORE the (expensive, seed-touching) unlock, so a frozen or disabled
// account never decrypts the seed at all.
//
// Network: the 2-of-2 MuSig2 key-path scheme uses no taproot tweak
// (sdk.coSigner.deriveMuSig2P2TR returns tweaks: []), and the co-signer's
// sighash + output-gate operate on raw scripts, so the decision is
// network-agnostic. Address-form allowedOutputs are resolved to `script`
// hex at provisioning (where the SDK knows the network); callers may still
// pass an explicit `network` for belt-and-suspenders.

import { withUnlocked } from './unlockWallet.js';
import { decodeWif } from '../crypto/wif.js';
import { buildAccountWindowStore } from '../cosigner/vaultWindowPersistence.js';
import { passiveCoSign } from './passiveCoSign.js';
import { assertSigningAllowed, PanicModeActiveError } from './panicMode.js';

export class CoSignerAccountNotFoundError extends Error {
    constructor(accountId) {
        super(`passiveCoSignForAccount: no co-signer account with id "${accountId}"`);
        this.name = 'CoSignerAccountNotFoundError';
        this.accountId = accountId;
    }
}

/**
 * @typedef {Object} PassiveCoSignForAccountOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} accountId                 the CoSignerAccount to act as
 * @property {string} password                  wallet unlock password
 * @property {string} [bip39Passphrase]
 * @property {import('./passiveCoSign.js').PassiveCoSignRequest} request
 * @property {boolean} [allowConfirmable]        default false (a daemon denies confirm-required actions)
 * @property {object} [network]                  optional bitcoinjs network (for address-form allowedOutputs)
 * @property {number} [now]                      injectable clock (ms) for the panic-mode check
 */

/**
 * Run a passive co-sign decision for a stored account.
 *
 * @param {PassiveCoSignForAccountOpts} opts
 * @returns {Promise<import('./passiveCoSign.js').PassiveCoSignResult>}
 */
export async function passiveCoSignForAccount(opts = {}) {
    const {
        vault,
        chainRegistry,
        sdkRegistry,
        accountId,
        password,
        bip39Passphrase,
        request,
        allowConfirmable,
        network,
        now,
    } = opts;

    if (!vault) throw new Error('passiveCoSignForAccount: vault is required');
    if (!chainRegistry) throw new Error('passiveCoSignForAccount: chainRegistry is required');
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('passiveCoSignForAccount: sdkRegistry is required');
    }
    if (typeof accountId !== 'string' || accountId.length === 0) {
        throw new Error('passiveCoSignForAccount: accountId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('passiveCoSignForAccount: password is required');
    }
    if (!request || typeof request.psbt !== 'string' || request.psbt.length === 0) {
        throw new Error('passiveCoSignForAccount: request.psbt (hex) is required');
    }

    const account = await vault.coSignerAccounts.get(accountId);
    if (!account) throw new CoSignerAccountNotFoundError(accountId);

    // A disabled account refuses everything, without unlocking.
    if (account.enabled === false) {
        return { approved: false, reason: 'ACCOUNT_DISABLED', detail: { accountId } };
    }

    // §26.5 panic-mode freeze, checked before the expensive seed-touching
    // unlock so a frozen wallet never decrypts its seed.
    try {
        assertSigningAllowed(now);
    } catch (e) {
        if (e instanceof PanicModeActiveError) {
            return { approved: false, reason: 'PANIC_MODE', detail: { remainingMs: e.remainingMs ?? null } };
        }
        throw e;
    }

    const sdk = sdkRegistry.get(account.chainId);
    const windowStore = buildAccountWindowStore({ vault, account, now });

    // Resolve the chain's bitcoinjs network from the SDK (single source of
    // network truth) unless the caller supplied one. The co-signer decision
    // itself is network-agnostic for script-form allowedOutputs, but passing
    // the network keeps address-form outputs working too.
    const resolvedNetwork = network
        ?? (sdk && sdk.wallet && typeof sdk.wallet.getBitcoinNetwork === 'function'
            ? sdk.wallet.getBitcoinNetwork()
            : null);

    return withUnlocked(
        { vault, walletId: account.walletId, password, bip39Passphrase, chainRegistry, sdkRegistry },
        async (signer) => {
            const wif = signer.exportWifForPath({
                chainId: account.chainId,
                path: account.daemonDerivationPath,
            });
            const { privateKey } = decodeWif(wif);
            try {
                return await passiveCoSign({
                    sdk,
                    secretKey: privateKey,
                    publicKeys: account.publicKeyOrder,
                    policy: account.policy,
                    windowStore,
                    // 2-of-2 MuSig2 key-path aggregate: no tweak (see module header).
                    tweaks: [],
                    network: resolvedNetwork,
                    allowedOutputs: account.allowedOutputs,
                    allowConfirmable,
                    request,
                    now,
                });
            } finally {
                privateKey.fill(0);
            }
        },
    );
}
