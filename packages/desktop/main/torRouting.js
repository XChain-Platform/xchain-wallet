// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Applying `settings.privacy.torRouting`.
//
// Three separate egress paths leave the desktop main process, and a
// toggle that covered two of them would be worse than useless: the user
// would believe they were anonymised while one lane kept reporting their
// address straight to a server. So all three move together, or the
// wallet says it failed.
//
//   1. xchain-sdk's axios clients (explorer, encoder, hub) - Node
//      http/https sockets, routed by handing the SDKRegistry a pool of
//      SOCKS agents.
//   2. Node's global `fetch` (undici) - price lookups, token metadata,
//      chain-registry sync. undici ignores http.Agent entirely and takes
//      a custom `connect` instead.
//   3. Chromium's own stack, for anything the renderer fetches and for
//      electron-updater - `session.setProxy`.
//
// TURNING IT OFF PUTS EVERYTHING BACK. Each path has an explicit
// restore, because a half-reverted proxy is a wallet that quietly stops
// working the moment the user closes Tor.

import { setGlobalDispatcher, getGlobalDispatcher, Agent as UndiciAgent } from 'undici';

import { createSocksAgents, parseSocksAddress, probeSocks, DEFAULT_SOCKS } from './socksAgent.js';

/** The dispatcher in force before we touched anything, so "off" is exact. */
let originalDispatcher = null;
/** What we last applied, so repeated applies are cheap and idempotent. */
let applied = { on: false, host: null, port: null };

/**
 * Read the effective proxy address from settings.
 * The toggle is a boolean; the address is Tor's default unless the user
 * set `privacy.socksProxyAddress`.
 *
 * @param {object} settings
 * @returns {{ enabled: boolean, proxy: { host: string, port: number } }}
 */
export function readTorSettings(settings) {
    const enabled = Boolean(settings?.privacy?.torRouting);
    let proxy = { ...DEFAULT_SOCKS };
    try {
        proxy = parseSocksAddress(settings?.privacy?.socksProxyAddress);
    } catch {
        // An unparseable address is not a reason to fall back to DIRECT
        // traffic while the toggle reads "on". Keep the Tor default and
        // let the connection fail loudly if nothing is listening there.
        proxy = { ...DEFAULT_SOCKS };
    }
    return { enabled, proxy };
}

/**
 * Apply (or undo) Tor routing across every egress path.
 *
 * @param {Object} params
 * @param {object} params.settings
 * @param {{ setPool: Function }} params.sdkRegistry
 * @param {{ setProxy: Function }} [params.session]  Electron session; omitted in tests
 * @param {() => Array<{ setProxy: Function }>} [params.extraSessions]  other live Electron sessions that follow the same proxy
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{ on: boolean, proxy?: {host:string,port:number}, reachable?: boolean, reason?: string }>}
 */
export function applyTorRouting(params) {
    // One apply at a time: the probe awaits the network, so a second toggle
    // landing mid-probe would otherwise finish first and be overwritten by
    // the older, slower apply.
    const run = applyQueue.then(() => applyNow(params));
    applyQueue = run.catch(() => {});
    return run;
}

/** Tail of the apply chain. */
let applyQueue = Promise.resolve();

/**
 * Chromium proxy settings for the routing in force, for a session that is
 * created after the toggle (the isolated Trezor Connect window).
 *
 * @returns {{ mode: 'direct' } | { proxyRules: string, proxyBypassRules: string }}
 */
export function currentProxyConfig() {
    if (!applied.on) return { mode: 'direct' };
    return { proxyRules: `socks5://${applied.host}:${applied.port}`, proxyBypassRules: '<-loopback>' };
}

/**
 * Put `session` on the routing in force.
 *
 * @param {{ setProxy: Function }} session
 */
export async function applyProxyToSession(session) {
    if (session?.setProxy) await session.setProxy(currentProxyConfig());
}

/**
 * True while any egress path may still be off direct: set before an on
 * apply touches anything, cleared only by an off that restores every path.
 * A failed apply leaves `applied` off but this set, so the next off still
 * restores and the next on still applies in full.
 */
let routed = false;

/**
 * Run `fn` on every session, so one rejection never skips the rest, and
 * rethrow the first failure once all have been tried.
 */
async function forEachSession(sessions, fn) {
    let firstError = null;
    for (const s of sessions) {
        try {
            await fn(s);
        } catch (err) {
            if (!firstError) firstError = err;
        }
    }
    if (firstError) throw firstError;
}

async function applyNow({ settings, sdkRegistry, session, extraSessions = () => [], log = () => {} }) {
    const { enabled, proxy } = readTorSettings(settings);

    if (!enabled) {
        if (applied.on || routed) {
            // Restore, in the reverse order of application. `applied` reads
            // off whatever happens below, because the main session and
            // dispatcher go direct first; a rejecting session leaves
            // `routed` set so the next off retries it.
            try {
                if (originalDispatcher) setGlobalDispatcher(originalDispatcher);
                const sessions = [...(session?.setProxy ? [session] : []), ...extraSessions()];
                sdkRegistry?.setPool?.(null);
                await forEachSession(sessions, (s) => s.setProxy({ mode: 'direct' }));
                routed = false;
                log('[xchain] Tor routing off: traffic is direct again');
            } finally {
                applied = { on: false, host: null, port: null };
            }
        }
        applied = { on: false, host: null, port: null };
        return { on: false };
    }

    const already = applied.on && applied.host === proxy.host && applied.port === proxy.port;
    if (already) return { on: true, proxy, reachable: true };

    // Probe first. Turning the toggle on with no Tor running would
    // otherwise present as every balance failing to load, with nothing
    // saying why. The routing is still applied either way: refusing to
    // apply it would mean the toggle reads "on" while traffic goes
    // direct, which is the bug this whole item is about.
    const reach = await probeSocks(proxy);

    const { httpAgent, httpsAgent, connect } = createSocksAgents(proxy);

    routed = true;
    try {
        // 1. the SDK's axios clients
        sdkRegistry?.setPool?.({ httpAgent, httpsAgent });

        // 2. Node's global fetch
        if (!originalDispatcher) originalDispatcher = getGlobalDispatcher();
        setGlobalDispatcher(new UndiciAgent({ connect }));

        // 3. Chromium (renderer + electron-updater)
        if (session?.setProxy) {
            await session.setProxy({
                proxyRules: `socks5://${proxy.host}:${proxy.port}`,
                // Without this, Chromium resolves hostnames locally before
                // handing them to the proxy, which leaks every destination to
                // the user's DNS resolver while looking like it works.
                proxyBypassRules: '<-loopback>',
            });
        }

        // Marked on before the extra sessions so a session created while
        // they apply asks for the SOCKS proxy, not direct.
        applied = { on: true, host: proxy.host, port: proxy.port };
        await forEachSession(extraSessions(), applyProxyToSession);
    } catch (err) {
        // A session that refused the proxy may be direct; reporting on
        // would hide that, and the `already` shortcut would skip the retry.
        applied = { on: false, host: null, port: null };
        throw err;
    }
    log(reach.ok
        ? `[xchain] Tor routing on via ${proxy.host}:${proxy.port}`
        : `[xchain] Tor routing on via ${proxy.host}:${proxy.port}, but the proxy did not answer (${reach.reason}). Requests will fail until it does.`);

    return { on: true, proxy, reachable: reach.ok, reason: reach.reason };
}

/** Test helper: forget what was applied. */
export function resetTorRoutingState() {
    originalDispatcher = null;
    applied = { on: false, host: null, port: null };
    routed = false;
    applyQueue = Promise.resolve();
}
