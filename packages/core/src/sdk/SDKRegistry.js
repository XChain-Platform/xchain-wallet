// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SDKRegistry — §10.2. Instantiates one SDK per active chain, lazily.
//
// `core` deliberately does NOT import xchain-sdk. The SDK is CommonJS,
// heavy (pulls in express/axios/bitcoinjs-lib), and each shell target
// has its own preferences about how to bundle/polyfill it. Shells pass
// in an SDKFactory; core just calls it.

/**
 * @typedef {Object} SDKConstructorOpts
 * @property {string} network           chainId, e.g. 'bitcoin-mainnet'
 * @property {string} explorerUrl       fully-formed URL
 * @property {string} encoderUrl
 * @property {string} hubUrl
 */

/**
 * A minimal description of the SDK surface the wallet depends on. Real
 * `xchain-sdk` instances satisfy this shape plus much more.
 *
 * @typedef {Object} XChainSDKLike
 * @property {Object} wallet
 * @property {(publicKey: string, opts: { type: string }) => string} wallet.deriveAddress
 * @property {(psbtHex: string, wif: string) => { txHex: string, txid: string, psbtHex: string }} wallet.signPsbt
 * @property {(psbtHex: string) => import('../signers/types').DecomposedPsbt} wallet.decomposePsbt
 * @property {(txHex: string) => string} wallet.txidOf
 * @property {(address: string, network?: string) => { valid: boolean, type: string|null, network: string|null, error: string|null }} wallet.validateAddress
 * @property {(txHex: string, encoder?: unknown) => Promise<{ txid: string }>} wallet.broadcastTx
 * @property {Object} auth
 * @property {(message: string, wif: string, opts?: { segwitNative?: boolean, segwitRedeemScript?: boolean }) => string} auth.signMessage
 * @property {(address: string, message: string, signature: string, network?: string) => boolean} auth.verifyMessage
 * @property {(address: string, opts?: { message?: string }) => string} auth.generateChallenge
 * @property {() => Promise<void>} [init]
 * @property {() => void} [close]
 * @property {() => Promise<any>} [connectWs]                                                       §46 — open the explorer WebSocket
 * @property {() => void} [disconnectWs]
 * @property {(address: string, callback: (msg: any) => void, opts?: object) => (() => void)} [onAddress]   subscribe to an address; returns unsubscribe
 * @property {(address: string, callback: (msg: any) => void, opts?: object) => (() => void)} [onOrderMatch]
 * @property {(actionIndex: number|string, callback: (msg: any) => void) => (() => void)} [onDispenser]
 * @property {(address: string, callback: (msg: any) => void) => (() => void)} [onCoinpayRequired]
 */

/**
 * @typedef {(opts: SDKConstructorOpts) => XChainSDKLike} SDKFactory
 */

/**
 * Partial per-chain endpoint overrides sourced from Settings.sdkEndpoints
 * (§11.3.7). Any missing field falls back to the chain descriptor.
 *
 * @typedef {Object} EndpointOverride
 * @property {string} [explorerUrl]
 * @property {string} [encoderUrl]
 * @property {string} [hubUrl]
 */

export class UnknownChainError extends Error {
    constructor(chainId) {
        super(`SDKRegistry: unknown chain "${chainId}"`);
        this.name = 'UnknownChainError';
        this.chainId = chainId;
    }
}

export class SDKRegistry {
    /**
     * @param {Object} opts
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {SDKFactory} opts.sdkFactory
     * @param {Record<string, EndpointOverride>} [opts.endpointOverrides]
     */
    constructor({ chainRegistry, sdkFactory, endpointOverrides = {} }) {
        if (!chainRegistry) throw new Error('SDKRegistry: chainRegistry is required');
        if (typeof sdkFactory !== 'function') {
            throw new Error('SDKRegistry: sdkFactory must be a function');
        }
        this._chainRegistry = chainRegistry;
        this._sdkFactory = sdkFactory;
        this._endpointOverrides = endpointOverrides;
        /** @type {Map<string, XChainSDKLike>} */
        this._instances = new Map();
    }

    /**
     * Get (or lazily create) the SDK instance for a chain.
     * @param {string} chainId
     * @returns {XChainSDKLike}
     */
    get(chainId) {
        const existing = this._instances.get(chainId);
        if (existing) return existing;
        const created = this._create(chainId);
        this._instances.set(chainId, created);
        return created;
    }

    /** @param {string} chainId */
    has(chainId) {
        return this._chainRegistry.has(chainId);
    }

    /** Chains that have been instantiated so far. */
    activeChainIds() {
        return Array.from(this._instances.keys());
    }

    /**
     * Eagerly instantiate + init the listed chains in parallel. Per
     * §10.2: at launch, kick off BTC / DOGE / LTC.
     * @param {string[]} chainIds
     */
    async initActive(chainIds) {
        await Promise.all(
            chainIds.map((id) => {
                const sdk = this.get(id);
                return sdk.init ? sdk.init() : undefined;
            }),
        );
    }

    /**
     * Replace one instance — used when the user changes endpoints in
     * Settings, so the next `get(chainId)` uses fresh URLs.
     * @param {string} chainId
     */
    invalidate(chainId) {
        const sdk = this._instances.get(chainId);
        if (sdk && typeof sdk.close === 'function') {
            try { sdk.close(); } catch { /* swallow */ }
        }
        this._instances.delete(chainId);
    }

    /** Invalidate all instances. */
    invalidateAll() {
        for (const id of Array.from(this._instances.keys())) this.invalidate(id);
    }

    /**
     * Merge new endpoint overrides. Does NOT rebuild existing instances;
     * callers who want the changes applied immediately should also call
     * `invalidate(chainId)` or `invalidateAll()`.
     *
     * @param {Record<string, EndpointOverride>} overrides
     */
    setEndpointOverrides(overrides) {
        this._endpointOverrides = { ...this._endpointOverrides, ...overrides };
    }

    /** @param {string} chainId */
    _create(chainId) {
        const d = this._chainRegistry.get(chainId);
        if (!d) throw new UnknownChainError(chainId);
        const over = this._endpointOverrides[chainId] ?? {};
        return this._sdkFactory({
            network: chainId,
            explorerUrl: over.explorerUrl ?? joinEndpoint(d.explorer),
            encoderUrl: over.encoderUrl ?? joinEndpoint(d.encoder),
            hubUrl: over.hubUrl ?? joinEndpoint(d.hub),
        });
    }
}

/** @param {import('../registry/validate.js').EndpointConfig} e */
function joinEndpoint(e) {
    // 80/443 are implicit; omit to match conventional URLs.
    if (e.defaultPort === 80 || e.defaultPort === 443) return e.defaultUrl;
    return `${e.defaultUrl}:${e.defaultPort}`;
}
