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

import { explorerErrorCode } from '../sdk/explorerErrors.js';
import { explorerPausedSeconds } from '../sdk/explorerRateLimit.js';

const DEFAULT_TIMEOUT_MS = 3000;
// The wallet's request layer retries a refused request behind a backoff, so a
// probe that was refused outright still sits until its timeout. When some probes
// are still pending after this long, the services they cover are asked directly
// whether the connection is refused, which takes milliseconds.
const DEFAULT_WIRE_DELAY_MS = 800;
const DEFAULT_WIRE_TIMEOUT_MS = 1200;
const PROBE_TIMEOUT_CODE = 'PROBE_TIMEOUT';
const SERVICE_NAMES = ['encoder', 'hub', 'explorer'];
const REFUSAL_CODES = new Set(['ERR_NETWORK', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET']);
const REFUSAL_MESSAGE = /\b(network error|failed to fetch|econnrefused|enotfound|eai_again|err_network|err_internet_disconnected|ping reported unreachable)\b/i;

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
 * @property {boolean} [failedFast]  offline, and every configured service refused the connection outright instead of timing out
 */

/**
 * @typedef {Object} ReachabilityResult
 * @property {'normal' | 'degraded' | 'offline'} overall
 * @property {ChainReachability[]} perChain
 * @property {boolean} [failedFast]  offline, and at least one chain's every service refused the connection outright
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
 * @property {WireCheck} [wireCheck]       asks a service directly whether the connection is refused
 * @property {number} [wireDelayMs]        how long probes may stay pending before the wire check runs
 * @property {number} [wireTimeoutMs]      how long one wire check may take
 */

/**
 * @typedef {(sdk: any, service: 'encoder' | 'hub' | 'explorer', timeoutMs: number) => Promise<'refused' | 'answered' | 'unknown'>} WireCheck
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
    wireCheck = defaultWireCheck,
    wireDelayMs = DEFAULT_WIRE_DELAY_MS,
    wireTimeoutMs = DEFAULT_WIRE_TIMEOUT_MS,
}) {
    if (!sdkRegistry) throw new Error('checkReachability: sdkRegistry is required');
    if (!Array.isArray(chainIds) || chainIds.length === 0) {
        throw new Error('checkReachability: chainIds must be a non-empty array');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('checkReachability: timeoutMs must be a positive number');
    }
    const encoderProbe = probes.encoder === null
        ? null
        : probes.encoder ?? defaultEncoderProbe;
    const hubProbe = probes.hub === null ? null : probes.hub ?? defaultHubProbe;
    const explorerProbe = probes.explorer === null
        ? null
        : probes.explorer ?? sharedPerHost(defaultExplorerProbe);

    // Chains on one host share each wire answer for the length of this check.
    const wireAnswers = new Map();
    const sharedWireCheck = (sdk, service, ms) => {
        const url = wireUrl(sdk, service);
        if (!url) return Promise.resolve('unknown');
        if (!wireAnswers.has(url)) {
            wireAnswers.set(url, Promise.resolve().then(() => wireCheck(sdk, service, ms)).catch(() => 'unknown'));
        }
        return wireAnswers.get(url);
    };

    const perChain = await Promise.all(
        chainIds.map((chainId) =>
            probeChain({
                chainId,
                sdk: sdkRegistry.get(chainId),
                encoderProbe,
                hubProbe,
                explorerProbe,
                timeoutMs,
                wireCheck: sharedWireCheck,
                wireDelayMs,
                wireTimeoutMs,
            }),
        ),
    );

    const overall = rollupOverall(perChain);
    const result = { overall, perChain };
    if (overall === 'offline' && perChain.some((c) => c.failedFast === true)
        && perChain.every((c) => c.mode === 'not-configured' || c.failedFast === true)) {
        result.failedFast = true;
    }
    return result;
}

/**
 * @returns {Promise<ChainReachability>}
 */
async function probeChain({
    chainId, sdk, encoderProbe, hubProbe, explorerProbe, timeoutMs,
    wireCheck, wireDelayMs, wireTimeoutMs,
}) {
    /** @type {Record<string, number>} */
    const latencyMs = {};
    /** @type {Record<string, string>} */
    const errors = {};
    /** @type {Record<string, unknown>} */
    const values = {};
    const probesByService = { encoder: encoderProbe, hub: hubProbe, explorer: explorerProbe };
    const configured = SERVICE_NAMES.filter((name) => probesByService[name] !== null);
    const refusals = createRefusalTracker(configured);

    const full = Promise.all(
        SERVICE_NAMES.map((name) => runProbe(name, sdk, probesByService[name], timeoutMs, latencyMs, errors, values, refusals)),
    ).then((services) => {
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
        if (result.mode === 'offline' && refusals.complete()) result.failedFast = true;
        return result;
    });
    if (configured.length === 0) return full;

    // Every service refusing the connection is the verdict without waiting out
    // the probes the request layer is still retrying.
    const wireTimer = setTimeout(() => {
        for (const name of configured) {
            if (refusals.has(name)) continue;
            wireCheck(sdk, name, wireTimeoutMs).then((answer) => {
                if (answer !== 'refused') return;
                if (errors[name] === undefined) errors[name] = 'connection refused';
                refusals.mark(name);
            });
        }
    }, wireDelayMs);
    const early = refusals.done.then(() => ({
        chainId,
        services: Object.fromEntries(SERVICE_NAMES.map((name) => [
            name,
            probesByService[name] === null ? 'not-configured' : 'unreachable',
        ])),
        mode: 'offline',
        errors: { ...errors },
        failedFast: true,
    }));
    try {
        return await Promise.race([full, early]);
    } finally {
        clearTimeout(wireTimer);
    }
}

/**
 * Which services have turned the connection away outright. It completes once
 * every configured service has, and never completes if any one has not.
 *
 * @param {string[]} names
 */
function createRefusalTracker(names) {
    const seen = new Set();
    /** @type {() => void} */
    let finish = () => {};
    const done = new Promise((resolve) => { finish = () => resolve(undefined); });
    const complete = () => names.length > 0 && names.every((name) => seen.has(name));
    return {
        done,
        has: (name) => seen.has(name),
        complete,
        mark(name) {
            seen.add(name);
            if (complete()) finish();
        },
    };
}

/** A probe error that is a refused connection, as opposed to a timeout or an HTTP answer. */
function isRefusal(e) {
    if (!e || e.code === PROBE_TIMEOUT_CODE) return false;
    if (REFUSAL_CODES.has(e.code)) return true;
    return REFUSAL_MESSAGE.test(String(e.message ?? e));
}

async function runProbe(name, sdk, probe, timeoutMs, latencyMs, errors, values, refusals) {
    if (probe === null) return 'not-configured';
    const start = Date.now();
    try {
        const value = await runWithTimeout(() => probe(sdk), timeoutMs);
        latencyMs[name] = Date.now() - start;
        if (values) values[name] = value;
        return 'reachable';
    } catch (e) {
        errors[name] = e && e.message ? e.message : String(e);
        if (isRefusal(e)) refusals.mark(name);
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
                reject(Object.assign(new Error(`probe timed out after ${timeoutMs}ms`), { code: PROBE_TIMEOUT_CODE }));
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
    if (typeof sdk.pingEncoder === 'function') return assertPinged(await sdk.pingEncoder(), 'encoder');
    if (sdk.encoder && typeof sdk.encoder.ping === 'function') return assertPinged(await sdk.encoder.ping(), 'encoder');
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
    if (typeof sdk.pingHub === 'function') return assertPinged(await sdk.pingHub(), 'hub');
    if (sdk.hub && typeof sdk.hub.ping === 'function') return assertPinged(await sdk.hub.ping(), 'hub');
    throw new Error('hub ping not available on SDK');
}

/** A probe that RESOLVES falsy is a failed probe, not a reachable service. */
function assertPinged(result, service) {
    if (result === false || result == null) throw new Error(`${service} ping reported unreachable`);
    return result;
}

/**
 * Run a probe once per explorer host for one reachability check.
 *
 * The explorer's /status document covers every coin the host serves (its maps
 * are keyed by coin), so BTC, LTC and DOGE on one host need one read, not three.
 *
 * @param {ServiceProbe} probe
 * @returns {ServiceProbe}
 */
function sharedPerHost(probe) {
    const byHost = new Map();
    return (sdk) => {
        const ex = sdk && sdk.explorer;
        const host = ex && typeof ex.baseUrl === 'string' ? `${ex.baseUrl}:${ex.port ?? ''}` : null;
        if (!host) return probe(sdk);
        if (!byHost.has(host)) byHost.set(host, Promise.resolve().then(() => probe(sdk)));
        return byHost.get(host);
    };
}

/** @type {ServiceProbe} */
async function defaultExplorerProbe(sdk) {
    // /status is the probe of choice: one request that both answers "is it
    // up" and carries the per-coin freshness maps (stale, last_block,
    // tip_age_seconds, replica_halted) the banner turns into "balances and
    // history are behind, last confirmed block N was X ago". It is also the
    // one route the explorer keeps reachable whatever state a coin is in.
    // A host paused for a rate limit has answered recently, so it is up; asking
    // again would only wait in the queue past the probe's timeout.
    if (explorerPausedSeconds(sdk) > 0) return undefined;
    if (typeof sdk.getStatus === 'function') {
        try {
            return await sdk.getStatus();
        } catch (e) {
            const msg = String(e?.message ?? e);
            if (/\b(4\d\d|5\d\d)\b/.test(msg)) return undefined;
            // A rate limit is the explorer answering, so it is reachable.
            if (explorerErrorCode(e) === 'RATE_LIMITED') return undefined;
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
        if (/\b(4\d\d|5\d\d)\b/.test(msg)) return;
        if (explorerErrorCode(e) === 'RATE_LIMITED') return;
        throw e;
    }
}

/**
 * The origin a direct connection check for this service would dial, or null
 * when there is nothing safe to dial: no http(s) address on the client, or
 * traffic routed through a proxy agent (a direct request would go around it).
 *
 * @param {any} sdk
 * @param {'encoder' | 'hub' | 'explorer'} service
 * @returns {string | null}
 */
function wireUrl(sdk, service) {
    const client = sdk ? sdk[service] : null;
    if (!client || typeof client !== 'object') return null;
    const pool = client._pool;
    if (pool && typeof pool === 'object' && Object.keys(pool).length > 0) return null;
    let address;
    if (service === 'hub') {
        address = Array.isArray(client.urls) ? client.urls[client._lastGoodIdx ?? 0] : client.url;
    } else {
        address = client.client?.defaults?.baseURL;
    }
    if (typeof address !== 'string' || !/^https?:\/\//i.test(address)) return null;
    try {
        return new URL(address).origin;
    } catch {
        return null;
    }
}

/**
 * Ask a service's origin for nothing in particular, once, with no retry. A
 * reply of any kind means the connection works; a rejection before the budget
 * ends means it was refused (connection refused, DNS failure, device offline);
 * running out of budget says only that the link is slow.
 *
 * @type {WireCheck}
 */
async function defaultWireCheck(sdk, service, timeoutMs) {
    const url = wireUrl(sdk, service);
    if (!url || typeof fetch !== 'function' || typeof AbortController !== 'function') return 'unknown';
    const controller = new AbortController();
    let outOfTime = false;
    const timer = setTimeout(() => { outOfTime = true; controller.abort(); }, timeoutMs);
    try {
        await fetch(url, {
            method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        return 'answered';
    } catch (e) {
        return outOfTime || (e && e.name === 'AbortError') ? 'unknown' : 'refused';
    } finally {
        clearTimeout(timer);
    }
}
