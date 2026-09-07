// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reachability checks (§49.1). Classify each chain's services
// (explorer, encoder, hub) as reachable or not, and roll up into a
// per-chain and overall mode.
//
// Probe policy:
//   - encoder:  `sdk.pingEncoder()` if present
//   - hub:      `sdk.pingHub()`     if present
//   - explorer: caller-supplied probe, or a fallback that calls
//               `sdk.explorer._get('/')`. The explorer doesn't expose
//               a dedicated ping, so we hit its root with a short
//               timeout. Most deployments return 200 or 404 quickly
//               either way; the probe only cares that the TCP+HTTP
//               round-trip completes.
//
// Callers that want bespoke probes (e.g. HEAD requests via fetch,
// WebSocket liveness) inject them via `probes` and override any of the
// three. A `null` probe entry disables the check for that service and
// reports `'not-configured'` instead of reachable/unreachable.
//
// Timeouts default to 3000 ms per service; callers polling frequently
// should pick a lower value to keep the aggregate bounded.

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * @typedef {'reachable' | 'unreachable' | 'not-configured'} ServiceStatus
 */

/**
 * How current the explorer's indexed data for this chain is, read off the
 * `/status` body the default explorer probe fetches. The explorer SERVES a
 * chain whose indexed tip is behind (marked, never refused), so "reachable"
 * alone no longer says the balances and history it answers are current; this
 * does. Absent when the explorer does not measure the chain or the probe was
 * not the default one.
 * @typedef {Object} ExplorerFreshness
 * @property {boolean} stale
 * @property {number | null} tipBlock         newest indexed block
 * @property {number | null} tipAgeSeconds    how old that block is
 * @property {boolean | null} replicaHalted   the indexer replica carries an active halt
 */

/**
 * @typedef {Object} ChainReachability
 * @property {string} chainId
 * @property {{ explorer: ServiceStatus, encoder: ServiceStatus, hub: ServiceStatus }} services
 * @property {'normal' | 'degraded' | 'offline' | 'not-configured'} mode
 * @property {Record<string, number>} [latencyMs]     populated when the probe succeeded
 * @property {Record<string, string>} [errors]        populated when the probe failed
 * @property {{ explorer: ExplorerFreshness }} [freshness]  populated when the explorer reported it
 */

/**
 * @typedef {Object} ReachabilityResult
 * @property {'normal' | 'degraded' | 'offline'} overall
 * @property {ChainReachability[]} perChain
 */

/**
 * @typedef {(sdk: import('../sdk/SDKRegistry.js').XChainSDKLike) => Promise<unknown>} ServiceProbe
 */

/**
 * @typedef {Object} CheckReachabilityOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} chainIds
 * @property {{ explorer?: ServiceProbe | null, encoder?: ServiceProbe | null, hub?: ServiceProbe | null }} [probes]
 * @property {number} [timeoutMs]
 */

/**
 * Run reachability probes across every active chain × configured
 * service. Probes run in parallel per chain and across chains.
 *
 * @param {CheckReachabilityOpts} opts
 * @returns {Promise<ReachabilityResult>}
 */
export async function checkReachability({
    sdkRegistry,
    chainIds,
    probes = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
    if (!sdkRegistry) throw new Error('checkReachability: sdkRegistry is required');
    if (!Array.isArray(chainIds) || chainIds.length === 0) {
        throw new Error('checkReachability: chainIds must be a non-empty array');
    }
    const encoderProbe = probes.encoder === null
        ? null
        : probes.encoder ?? defaultEncoderProbe;
    const hubProbe = probes.hub === null ? null : probes.hub ?? defaultHubProbe;
    const explorerProbe = probes.explorer === null
        ? null
        : probes.explorer ?? defaultExplorerProbe;

    const perChain = await Promise.all(
        chainIds.map((chainId) =>
            probeChain({
                chainId,
                sdk: sdkRegistry.get(chainId),
                encoderProbe,
                hubProbe,
                explorerProbe,
                timeoutMs,
            }),
        ),
    );

    return {
        overall: rollupOverall(perChain),
        perChain,
    };
}

/**
 * @returns {Promise<ChainReachability>}
 */
async function probeChain({ chainId, sdk, encoderProbe, hubProbe, explorerProbe, timeoutMs }) {
    /** @type {Record<string, number>} */
    const latencyMs = {};
    /** @type {Record<string, string>} */
    const errors = {};
    /** @type {Record<string, unknown>} */
    const values = {};
    const services = await Promise.all([
        runProbe('encoder', sdk, encoderProbe, timeoutMs, latencyMs, errors, values),
        runProbe('hub', sdk, hubProbe, timeoutMs, latencyMs, errors, values),
        runProbe('explorer', sdk, explorerProbe, timeoutMs, latencyMs, errors, values),
    ]);
    // The default explorer probe resolves the /status body, which carries the
    // per-coin freshness maps; a custom probe resolves whatever it likes and
    // yields no verdict.
    const freshness = explorerFreshnessFrom(values.explorer, sdk);
    const result = {
        chainId,
        services: {
            encoder: services[0],
            hub: services[1],
            explorer: services[2],
        },
        mode: classifyChainMode(services, freshness),
    };
    if (Object.keys(latencyMs).length > 0) result.latencyMs = latencyMs;
    if (Object.keys(errors).length > 0) result.errors = errors;
    if (freshness) result.freshness = { explorer: freshness };
    return result;
}

async function runProbe(name, sdk, probe, timeoutMs, latencyMs, errors, values) {
    if (probe === null) return 'not-configured';
    const start = Date.now();
    try {
        const value = await runWithTimeout(() => probe(sdk), timeoutMs);
        latencyMs[name] = Date.now() - start;
        if (values) values[name] = value;
        return 'reachable';
    } catch (e) {
        errors[name] = e && e.message ? e.message : String(e);
        return 'unreachable';
    }
}

/**
 * Read this chain's freshness off an explorer /status body. `/status` keys
 * every map by coin prefix (BTC / TBTC / RDOGE), the same prefix the SDK's
 * explorer client carries, so that is the only key consulted: a sibling
 * coin's staleness is a claim about a different chain.
 *
 * @param {unknown} status
 * @param {any} sdk
 * @returns {ExplorerFreshness | null}
 */
function explorerFreshnessFrom(status, sdk) {
    if (!status || typeof status !== 'object') return null;
    const s = /** @type {any} */ (status);
    const coin = sdk && sdk.explorer && typeof sdk.explorer.coin === 'string' ? sdk.explorer.coin : null;
    if (!coin || !s.stale || typeof s.stale !== 'object' || s.stale[coin] === undefined) return null;
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
        stale: s.stale[coin] === true,
        tipBlock: s.last_block && typeof s.last_block === 'object' ? num(s.last_block[coin]) : null,
        tipAgeSeconds: s.tip_age_seconds && typeof s.tip_age_seconds === 'object' ? num(s.tip_age_seconds[coin]) : null,
        replicaHalted: s.replica_halted && typeof s.replica_halted[coin] === 'boolean' ? s.replica_halted[coin] : null,
    };
}

function runWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`probe timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);
        Promise.resolve()
            .then(fn)
            .then((v) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(v);
                }
            })
            .catch((e) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(e);
                }
            });
    });
}

function classifyChainMode(services, freshness) {
    const statuses = services;
    const configured = statuses.filter((s) => s !== 'not-configured');
    if (configured.length === 0) return 'not-configured';
    const reachable = configured.filter((s) => s === 'reachable').length;
    if (reachable === 0) return 'offline';
    if (reachable < configured.length) return 'degraded';
    // Every service answered, but the explorer answered from behind the
    // chain: what the wallet shows is real and delayed, which is degraded in
    // the sense the banner exists for ("you're not getting fresh data").
    if (freshness && freshness.stale) return 'degraded';
    return 'normal';
}

function rollupOverall(perChain) {
    const modes = perChain.map((c) => c.mode).filter((m) => m !== 'not-configured');
    if (modes.length === 0) return 'offline';
    if (modes.every((m) => m === 'normal')) return 'normal';
    if (modes.every((m) => m === 'offline')) return 'offline';
    return 'degraded';
}

/** @type {ServiceProbe} */
async function defaultEncoderProbe(sdk) {
    if (typeof sdk.pingEncoder === 'function') return sdk.pingEncoder();
    if (sdk.encoder && typeof sdk.encoder.ping === 'function') return sdk.encoder.ping();
    throw new Error('encoder ping not available on SDK');
}

/**
 * The hub is the one service whose ping REPORTS failure instead of throwing
 * it: `hub.ping()` walks its endpoint list and returns `false` when every one
 * of them fails. `runProbe` treats any resolved value as reachable, so an
 * un-checked `false` made the hub eternally reachable - which meant no chain
 * could ever reach `offline` (that needs all three services down) and neither
 * could `overall`. Measured on an Android emulator with every mapping to the
 * venue removed: encoder and explorer reported Network Error, the hub reported
 * "reachable", and a device with no connectivity at all told the user "partly
 * unavailable; some features may not work" instead of "can't reach the
 * network" (SSC-6 session,).
 *
 * @type {ServiceProbe}
 */
async function defaultHubProbe(sdk) {
    if (typeof sdk.pingHub === 'function') return assertPinged(await sdk.pingHub());
    if (sdk.hub && typeof sdk.hub.ping === 'function') return assertPinged(await sdk.hub.ping());
    throw new Error('hub ping not available on SDK');
}

/** A probe that RESOLVES falsy is a failed probe, not a reachable service. */
function assertPinged(result) {
    if (result === false || result == null) throw new Error('hub ping reported unreachable');
    return result;
}

/** @type {ServiceProbe} */
async function defaultExplorerProbe(sdk) {
    // /status is the probe of choice: one request that both answers "is it
    // up" and carries the per-coin freshness maps (stale, last_block,
    // tip_age_seconds, replica_halted) the banner turns into "balances and
    // history are behind, last confirmed block N was X ago". It is also the
    // one route the explorer keeps reachable whatever state a coin is in.
    if (typeof sdk.getStatus === 'function') {
        try {
            return await sdk.getStatus();
        } catch (e) {
            const msg = String(e?.message ?? e);
            if (/\b(4\d\d|5\d\d)\b/.test(msg) || /status/i.test(msg)) return undefined;
            throw e;
        }
    }
    // Older SDK shape with no getStatus: hit the root path; the server
    // responds to any HTTP request with a routing result quickly. A
    // 404 from a live server still means "reachable" for our purposes
    // since the timeout, not the status, is what we measure against.
    if (!sdk.explorer || typeof sdk.explorer._get !== 'function') {
        throw new Error('explorer probe not available on SDK');
    }
    try {
        await sdk.explorer._get('/');
    } catch (e) {
        // If the error is a 4xx/5xx that arrived within the timeout
        // budget, the service is reachable (it just said "no"). A
        // network/timeout error surfaces distinguishably and gets
        // propagated to mark the service unreachable.
        const msg = String(e?.message ?? e);
        if (/\b(4\d\d|5\d\d)\b/.test(msg) || /status/i.test(msg)) return;
        throw e;
    }
}
