// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ChainRegistry: the chain set as data, not code. UI surfaces enumerate
// `registry.supportedChains()` and render from descriptor metadata (§9.7).
// Adding a chain means adding a descriptor; no code changes to pickers,
// filters, or forms.

import { BUNDLED_DESCRIPTORS } from './descriptors/index.js';
import { validateChainDescriptor } from './validate.js';
import { counterwalletDerivationPath } from '../crypto/counterwallet.js';

export class ChainRegistry {
    /**
     * @param {{ bundled?: import('./validate.js').ChainDescriptor[], userAdded?: import('./validate.js').ChainDescriptor[] }} [opts]
     */
    constructor(opts = {}) {
        const bundled = opts.bundled ?? BUNDLED_DESCRIPTORS;
        /** @type {Map<string, import('./validate.js').ChainDescriptor>} */
        this._entries = new Map();
        for (const d of bundled) this._install(d, false);
        for (const d of opts.userAdded ?? []) this._install(d, true);
    }

    /** @param {import('./validate.js').ChainDescriptor} descriptor */
    _install(descriptor, isUserAdded) {
        const res = validateChainDescriptor(descriptor);
        if (!res.ok) {
            throw new Error(
                `ChainRegistry: invalid descriptor "${descriptor?.id}": ${res.errors.join('; ')}`,
            );
        }
        if (this._entries.has(descriptor.id)) {
            throw new Error(
                `ChainRegistry: duplicate chain id "${descriptor.id}"`,
            );
        }
        this._entries.set(descriptor.id, { ...descriptor, isUserAdded });
    }

    /** @param {string} chainId */
    get(chainId) {
        return this._entries.get(chainId);
    }

    /** @param {string} chainId */
    has(chainId) {
        return this._entries.has(chainId);
    }

    /** @returns {import('./validate.js').ChainDescriptor[]} */
    supportedChains() {
        return Array.from(this._entries.values());
    }

    /** @param {string} coin  e.g. 'bitcoin' */
    byCoin(coin) {
        return this.supportedChains().filter((d) => d.coin === coin);
    }

    /** @param {'mainnet' | 'testnet' | 'regtest'} networkKind */
    byNetworkKind(networkKind) {
        return this.supportedChains().filter(
            (d) => d.networkKind === networkKind,
        );
    }

    coins() {
        return Array.from(new Set(this.supportedChains().map((d) => d.coin)));
    }

    /**
     * Forward lookup: given a chainId, return the descriptor or `null`.
     *
     * @param {string} chainId
     * @returns {import('./validate.js').ChainDescriptor | null}
     */
    descriptorFor(chainId) {
        return this._entries.get(chainId) ?? null;
    }

    /**
     * Reverse lookup: given (coin, networkKind) from an Address record,
     * return the matching chainId, or `null` if no descriptor matches.
     *
     * @param {string} coin          e.g. 'bitcoin'
     * @param {'mainnet' | 'testnet' | 'regtest'} networkKind
     * @returns {string | null}
     */
    chainIdFor(coin, networkKind) {
        for (const d of this._entries.values()) {
            if (d.coin === coin && d.networkKind === networkKind) return d.id;
        }
        return null;
    }

    /**
     * Resolve the BIP-style derivation path for a (chain, addressType,
     * account, change, index) tuple. Returns null if the chain or address
     * type isn't registered.
     *
     * A `counterwallet-legacy` wallet does not use the descriptor's
     * templates at all: it derives one chain, `m/0'/<change>/<index>`,
     * shared by every address type (§19.7). Resolving that here rather
     * than at each call site is deliberate - address derivation,
     * restore-discovery and the dry-run restore check all ask this one
     * function, and a legacy wallet whose three answers disagreed would
     * report a correct backup as broken.
     *
     * @param {string} chainId
     * @param {string} addressType
     * @param {number} accountIndex
     * @param {0 | 1} change   BIP44 branch: 0 external (receive/dispenser), 1 internal change (§16)
     * @param {number} index
     * @param {{ format?: 'bip39' | 'counterwallet-legacy' | 'wif-only' }} [opts]
     */
    derivationPathFor(chainId, addressType, accountIndex, change, index, opts = {}) {
        const d = this._entries.get(chainId);
        if (!d) return null;
        if (opts.format === 'counterwallet-legacy') {
            // Counterwallet had a single account, so there is no path
            // level to put a second one on. Deriving account 1 from the
            // account-0 path would hand back addresses that already
            // belong to account 0 - silently, and with real funds on
            // them - so refuse instead.
            if (accountIndex !== 0) {
                throw new Error(
                    'derivationPathFor: counterwallet-legacy wallets have a single account (m/0\'/C/I); '
                    + `cannot derive account ${accountIndex}`,
                );
            }
            return counterwalletDerivationPath(change, index);
        }
        const template = d.derivationPaths[addressType];
        if (!template) return null;
        // Anchored expansion of the fixed `A'/C/I` tail (validateChainDescriptor
        // guarantees the `m/<purpose>'/<coin-type>'/A'/C/I` shape). Matching the
        // trailing segment as a unit prevents an un-anchored single-char replace
        // from ever landing a substitution in the wrong path segment.
        return template.replace(
            /A'\/C\/I$/,
            `${accountIndex}'/${change}/${index}`,
        );
    }

    /**
     * Register a user-added chain at runtime (Developer Mode). Validates
     * the descriptor and sets isUserAdded = true.
     *
     * @param {import('./validate.js').ChainDescriptor} descriptor
     */
    addCustom(descriptor) {
        this._install(descriptor, true);
    }

    /** @param {string} chainId */
    removeCustom(chainId) {
        const entry = this._entries.get(chainId);
        if (!entry) return false;
        if (!entry.isUserAdded) {
            throw new Error(
                `ChainRegistry: "${chainId}" is bundled and cannot be removed`,
            );
        }
        return this._entries.delete(chainId);
    }

    /**
     * Hot-swap verified remote descriptors in place (§9.7 registry sync).
     * Additive-only: existing ids are replaced with the remote copy, new ids
     * are added, nothing is ever removed, and a user-added custom chain is
     * never clobbered by a remote id collision (the user's copy wins).
     * Callers MUST have signature-verified and validated the batch first
     * (syncChainRegistryFromHub in ./remote.js is the sanctioned path).
     *
     * @param {import('./validate.js').ChainDescriptor[]} descriptors
     * @returns {{ added: string[], updated: string[], skipped: string[] }}
     */
    applyRemoteDescriptors(descriptors) {
        const added = [], updated = [], skipped = [];
        for (const d of descriptors) {
            const res = validateChainDescriptor(d);
            if (!res.ok) {
                throw new Error(
                    `ChainRegistry: invalid remote descriptor "${d?.id}": ${res.errors.join('; ')}`,
                );
            }
        }
        for (const d of descriptors) {
            const existing = this._entries.get(d.id);
            if (existing?.isUserAdded) { skipped.push(d.id); continue; }
            this._entries.set(d.id, { ...d, isUserAdded: false });
            (existing ? updated : added).push(d.id);
        }
        return { added, updated, skipped };
    }
}

// Shared default instance (lazy singleton). Consumers across the app hold
// module-level `defaultRegistry()` references; sharing one instance is what
// lets a verified remote registry sync (applyRemoteDescriptors) hot-swap
// descriptors for every surface at once. Tests that mutate build their own
// `new ChainRegistry()` instead.
let _defaultRegistry = null;
export const defaultRegistry = () => (_defaultRegistry ??= new ChainRegistry());

export { BUNDLED_DESCRIPTORS } from './descriptors/index.js';
export { validateChainDescriptor, FAMILY_MAINNET_COIN_TYPE_SLOT, FAMILY_NETWORK_WIF_BYTE } from './validate.js';
export {
    COMMON_ACTIONS,
    BTC_EXCLUSIVE_ACTIONS,
    PROTOCOL_ONLY_ACTIONS,
    BITCOIN_ACTIONS,
    DOGECOIN_ACTIONS,
    LITECOIN_ACTIONS,
} from './actions.js';
export {
    FEE_UNITS,
    FEE_STRATEGY_NAMES,
    ADS_DONATION_ADDRESS_PLACEHOLDER,
    isDonationAddressConfigured,
} from './validate.js';
export { filterChainsForUser, isChainVisibleToUser } from './visibility.js';
export {
    verifyChainRegistry,
    syncChainRegistryFromHub,
    REGISTRY_SIGNING_DOMAIN,
    REGISTRY_PINNED_PUBKEY_HEX,
    REGISTRY_DEFAULT_URL,
} from './remote.js';
