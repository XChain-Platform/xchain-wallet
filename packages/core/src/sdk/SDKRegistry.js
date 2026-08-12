// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SDKRegistry: §10.2. Instantiates one SDK per active chain, lazily.
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
 * @property {number} [timeout] per-request ms budget (; see DEFAULT_SDK_NETWORK_OPTIONS)
 * @property {{ maxRetries: number, baseDelay: number, maxDelay: number }} [retry]
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
 * @property {() => Promise<any>} [connectWs]                                                       §46: open the explorer WebSocket
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

/** Settings field name -> descriptor field name, in factory-arg order. */
const ENDPOINT_FIELDS = Object.freeze([
    Object.freeze(['explorerUrl', 'explorer']),
    Object.freeze(['encoderUrl', 'encoder']),
    Object.freeze(['hubUrl', 'hub']),
]);

/**
 * (§49 offline/degraded mode): bounded network patience for every
 * SDK instance the wallet creates. xchain-sdk's own defaults are tuned
 * for servers: a 30s per-request timeout times 4 attempts (1 try + 3
 * retries) with exponential backoff is over two minutes of silence PER
 * CALL, which is why the wallet froze for ~7 minutes instead of
 * degrading when its backend was unreachable. An interactive wallet must
 * fail loudly in seconds; callers that genuinely need more patience can
 * override via the `networkOptions` constructor opt.
 */
export const DEFAULT_SDK_NETWORK_OPTIONS = Object.freeze({
    timeout: 10_000,
    retry: Object.freeze({ maxRetries: 1, baseDelay: 500, maxDelay: 2_000 }),
});

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
     * @param {{ timeout?: number, retry?: { maxRetries?: number, baseDelay?: number, maxDelay?: number } }} [opts.networkOptions]
     *        overrides for DEFAULT_SDK_NETWORK_OPTIONS (merged shallowly)
     */
    constructor({ chainRegistry, sdkFactory, endpointOverrides = {}, networkOptions = {} }) {
        if (!chainRegistry) throw new Error('SDKRegistry: chainRegistry is required');
        if (typeof sdkFactory !== 'function') {
            throw new Error('SDKRegistry: sdkFactory must be a function');
        }
        this._chainRegistry = chainRegistry;
        this._sdkFactory = sdkFactory;
        this._endpointOverrides = endpointOverrides;
        this._networkOptions = {
            timeout: networkOptions.timeout ?? DEFAULT_SDK_NETWORK_OPTIONS.timeout,
            retry: { ...DEFAULT_SDK_NETWORK_OPTIONS.retry, ...(networkOptions.retry ?? {}) },
            // `pool` carries the connection agents through to
            // xchain-sdk's HTTP clients. The desktop shell puts SOCKS5
            // agents here when Tor routing is on, which is the only way
            // the toggle can reach the SDK's own sockets. Undefined
            // everywhere else, so nothing changes for the other shells.
            pool: networkOptions.pool,
        };
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
     * Replace one instance (used when the user changes endpoints in
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

    /**
     * Adopt the operator's Settings -> Network & Endpoints record
     * as the live override set. This is what makes the panel real: before
     * it existed the setting persisted, the summary row said "1 chain
     * custom", and every SDK instance kept talking to the bundled
     * defaults, so an operator pointing the wallet at their own node was
     * quietly ignored.
     *
     * REPLACES the whole map (unlike `setEndpointOverrides`, which merges)
     * so "Reset to default" on a chain actually reverts it, and
     * invalidates only the chains whose effective endpoints moved, so a
     * settings save unrelated to endpoints does not tear down live SDK
     * instances (and their WebSockets).
     *
     * @param {{ sdkEndpoints?: Record<string, any> }} settings full Settings record
     * @returns {{ changed: string[] }} chain ids whose instances were dropped
     */
    applyEndpointOverridesFromSettings(settings) {
        const next = endpointOverridesFromSettings(settings, this._chainRegistry);
        const ids = new Set([
            ...Object.keys(this._endpointOverrides),
            ...Object.keys(next),
        ]);
        const changed = [];
        for (const id of ids) {
            if (!sameOverride(this._endpointOverrides[id], next[id])) changed.push(id);
        }
        this._endpointOverrides = next;
        for (const id of changed) this.invalidate(id);
        return { changed };
    }

    /** @param {string} chainId */
    _create(chainId) {
        const d = this._chainRegistry.get(chainId);
        if (!d) throw new UnknownChainError(chainId);
        const over = this._endpointOverrides[chainId] ?? {};
        return this._sdkFactory({
            network: chainId,
            explorerUrl: overrideUrl(over.explorerUrl) ?? joinEndpoint(d.explorer),
            encoderUrl: overrideUrl(over.encoderUrl) ?? joinEndpoint(d.encoder),
            hubUrl: overrideUrl(over.hubUrl) ?? joinEndpoint(d.hub),
            // Bounded network patience: the real XChainSDK honors
            // `timeout` + `retry` per client; the dev mock ignores them.
            timeout: this._networkOptions.timeout,
            retry: this._networkOptions.retry,
            ...(this._networkOptions.pool ? { pool: this._networkOptions.pool } : {}),
        });
    }

    /**
     * Swap the connection agents and drop every cached SDK instance so the
     * next `get()` dials through the new ones.
     *
     * Dropping the instances is the point, not housekeeping: xchain-sdk
     * builds its axios client once per instance, so a live instance would
     * keep using the agent it was born with. Toggling Tor on and seeing
     * traffic keep going direct is precisely the failure this feature
     * exists to end.
     *
     * @param {{ httpAgent?: any, httpsAgent?: any }|null} pool
     */
    setPool(pool) {
        this._networkOptions.pool = pool ?? undefined;
        this._instances.clear();
    }
}

/**
 * Recombine a descriptor endpoint into the URL the SDK is handed.
 *
 * Exported so the Settings editor can seed its draft with the
 * exact string the registry would otherwise use. Seeding from
 * `defaultUrl` alone dropped the port off every non-standard endpoint,
 * and the editor then saved that truncated value over all three fields.
 *
 * @param {import('../registry/validate.js').EndpointConfig} e
 * @returns {string}
 */
export function joinEndpoint(e) {
    if (!e || typeof e.defaultUrl !== 'string') return '';
    // 80/443 are implicit; omit to match conventional URLs.
    if (!Number.isFinite(e.defaultPort)) return e.defaultUrl;
    if (e.defaultPort === 80 || e.defaultPort === 443) return e.defaultUrl;
    return `${e.defaultUrl}:${e.defaultPort}`;
}

/** A usable override value, or null when the field should fall back. */
function overrideUrl(v) {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function sameOverride(a, b) {
    const l = a ?? {};
    const r = b ?? {};
    return ENDPOINT_FIELDS.every(([field]) => (l[field] ?? null) === (r[field] ?? null));
}

/**
 * Distil a Settings record into the override map `SDKRegistry` consumes.
 *
 * Only entries the user actually customised survive:
 *  - `custom !== true` is the editor's reset state, so it is skipped
 *    outright.
 *  - a value equal to the chain's own default is not an override.
 * - heal: records written by the pre-fix editor carry the bare
 *    `defaultUrl` with the port stripped ("http://localhost" where the
 *    default is "http://localhost:10000"). That is the seeding bug
 *    speaking, not the operator, and honouring it would point a live
 *    endpoint at a port nothing listens on. Treat it as "unset".
 *  - entries for chain ids this build does not know are dropped.
 *
 * @param {{ sdkEndpoints?: Record<string, any> }} settings
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {Record<string, EndpointOverride>}
 */
export function endpointOverridesFromSettings(settings, chainRegistry) {
    /** @type {Record<string, EndpointOverride>} */
    const out = {};
    const record = settings?.sdkEndpoints;
    if (!record || typeof record !== 'object') return out;
    for (const [chainId, entry] of Object.entries(record)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.custom !== true) continue;
        let descriptor = null;
        try {
            descriptor = chainRegistry?.has?.(chainId) ? chainRegistry.get(chainId) : null;
        } catch {
            descriptor = null;
        }
        if (!descriptor) continue;
        /** @type {EndpointOverride} */
        const over = {};
        for (const [field, key] of ENDPOINT_FIELDS) {
            const value = overrideUrl(entry[field]);
            if (!value) continue;
            const endpoint = descriptor[key];
            if (!endpoint) continue;
            if (value === joinEndpoint(endpoint)) continue;
            if (value === endpoint.defaultUrl) continue;
            over[field] = value;
        }
        if (Object.keys(over).length > 0) out[chainId] = over;
    }
    return out;
}
