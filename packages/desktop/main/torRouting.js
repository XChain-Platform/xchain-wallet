// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Applying `settings.privacy.torRouting` .
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
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{ on: boolean, proxy?: {host:string,port:number}, reachable?: boolean, reason?: string }>}
 */
export async function applyTorRouting({ settings, sdkRegistry, session, log = () => {} }) {
    const { enabled, proxy } = readTorSettings(settings);

    if (!enabled) {
        if (applied.on) {
            // Restore, in the reverse order of application.
            if (originalDispatcher) setGlobalDispatcher(originalDispatcher);
            if (session?.setProxy) await session.setProxy({ mode: 'direct' });
            sdkRegistry?.setPool?.(null);
            log('[xchain] Tor routing off: traffic is direct again');
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

    applied = { on: true, host: proxy.host, port: proxy.port };
    log(reach.ok
        ? `[xchain] Tor routing on via ${proxy.host}:${proxy.port}`
        : `[xchain] Tor routing on via ${proxy.host}:${proxy.port}, but the proxy did not answer (${reach.reason}). Requests will fail until it does.`);

    return { on: true, proxy, reachable: reach.ok, reason: reach.reason };
}

/** Test helper: forget what was applied. */
export function resetTorRoutingState() {
    originalDispatcher = null;
    applied = { on: false, host: null, port: null };
}
