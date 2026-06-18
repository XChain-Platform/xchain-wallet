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
 * @typedef {Object} ChainReachability
 * @property {string} chainId
 * @property {{ explorer: ServiceStatus, encoder: ServiceStatus, hub: ServiceStatus }} services
 * @property {'normal' | 'degraded' | 'offline' | 'not-configured'} mode
 * @property {Record<string, number>} [latencyMs]     populated when the probe succeeded
 * @property {Record<string, string>} [errors]        populated when the probe failed
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
    const services = await Promise.all([
        runProbe('encoder', sdk, encoderProbe, timeoutMs, latencyMs, errors),
        runProbe('hub', sdk, hubProbe, timeoutMs, latencyMs, errors),
        runProbe('explorer', sdk, explorerProbe, timeoutMs, latencyMs, errors),
    ]);
    const result = {
        chainId,
        services: {
            encoder: services[0],
            hub: services[1],
            explorer: services[2],
        },
        mode: classifyChainMode(services),
    };
    if (Object.keys(latencyMs).length > 0) result.latencyMs = latencyMs;
    if (Object.keys(errors).length > 0) result.errors = errors;
    return result;
}

async function runProbe(name, sdk, probe, timeoutMs, latencyMs, errors) {
    if (probe === null) return 'not-configured';
    const start = Date.now();
    try {
        await runWithTimeout(() => probe(sdk), timeoutMs);
        latencyMs[name] = Date.now() - start;
        return 'reachable';
    } catch (e) {
        errors[name] = e && e.message ? e.message : String(e);
        return 'unreachable';
    }
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

function classifyChainMode(services) {
    const statuses = services;
    const configured = statuses.filter((s) => s !== 'not-configured');
    if (configured.length === 0) return 'not-configured';
    const reachable = configured.filter((s) => s === 'reachable').length;
    if (reachable === configured.length) return 'normal';
    if (reachable === 0) return 'offline';
    return 'degraded';
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

/** @type {ServiceProbe} */
async function defaultHubProbe(sdk) {
    if (typeof sdk.pingHub === 'function') return sdk.pingHub();
    if (sdk.hub && typeof sdk.hub.ping === 'function') return sdk.hub.ping();
    throw new Error('hub ping not available on SDK');
}

/** @type {ServiceProbe} */
async function defaultExplorerProbe(sdk) {
    // Explorer has no dedicated ping. Hit the root path; the server
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
