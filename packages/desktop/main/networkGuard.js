// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Test network guard: a switch that keeps a desktop test run off every
// network except this machine and a named regtest host.
//
// Test runs reached hub.xchain.io and explorer.xchain.io because the
// network block lived in NODE_OPTIONS, which Playwright's electron.launch
// drops without a word. The guard is therefore read by the app itself,
// from an environment variable OR a command-line switch the harness puts
// in electron.launch args, and it is off unless one of them is set. It
// changes nothing about what the app signs or which network it defaults
// to; it only refuses connections.
//
// The desktop main process has three egress paths (torRouting.js lists
// them), and a guard on one of them would be decorative:
//
//   1. Node sockets: the SDK's axios clients and Node's global fetch
//      (undici) both end in net.Socket#connect, TLS included. The guard
//      wraps that one method, so a client with its own agent or a
//      replaced global dispatcher still cannot get past it, and the
//      refusal happens before any DNS lookup.
//   2. Tor routing hands the destination to a local SOCKS proxy, which
//      the socket wrap would allow (the proxy is on loopback); socksConnect
//      asks networkGuardRefusal() first.
//   3. Chromium (renderer, net.fetch, electron-updater): a webRequest
//      filter on every session, installed before the first window.
//
// Turning it on:
//   XCHAIN_TEST_NETWORK_GUARD=1           or  --xchain-test-network-guard
//   XCHAIN_TEST_NETWORK_GUARD_ALLOW=a,b   or  --xchain-test-network-guard-allow=a,b
//   --xchain-test-network-guard-probe     guard on, prove the refusals on a
//                                         reserved host, exit before any window

/** Environment variable that turns the guard on. */
export const GUARD_ENV = 'XCHAIN_TEST_NETWORK_GUARD';
/** Command-line switch that turns the guard on. */
export const GUARD_SWITCH = 'xchain-test-network-guard';
/** Extra hosts (a regtest stack) the guard lets through, comma separated. */
export const ALLOW_ENV = 'XCHAIN_TEST_NETWORK_GUARD_ALLOW';
export const ALLOW_SWITCH = 'xchain-test-network-guard-allow';
/** Probe mode: guard on, refusals proven, exit before any window. */
export const PROBE_SWITCH = 'xchain-test-network-guard-probe';

/** Hosts that are always this machine. */
export const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1']);

/** Every guard log line starts with this, so a harness can find them. */
export const LOG_PREFIX = '[xchain] network guard';
/** The one startup line; a harness waits for it before the first window. */
export const GUARD_ON_TEXT = `${LOG_PREFIX} on:`;
/** Logged once, as the first window is created, after the line above. */
export const FIRST_WINDOW_TEXT = `${LOG_PREFIX} active as the first window opens`;
/** Error code a refused Node connection fails with. */
export const REFUSAL_CODE = 'ERR_XCHAIN_NETWORK_GUARD';

// RFC 2606 reserves .invalid: if the guard ever failed to refuse, the probe
// would still not resolve, let alone reach, anything.
export const PROBE_URL = 'https://network-guard-probe.invalid/';

// Schemes that leave the machine. file:, data:, blob:, devtools: and the
// renderer's own scheme never do and must keep working.
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * Normalise a hostname for comparison: lower case, no IPv6 brackets, no
 * trailing root dot.
 *
 * @param {unknown} host
 * @returns {string}
 */
export function normaliseHost(host) {
    let h = String(host ?? '').trim().toLowerCase();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    if (h.endsWith('.')) h = h.slice(0, -1);
    return h;
}

/**
 * Split a comma or space separated host list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseHostList(value) {
    if (typeof value !== 'string') return [];
    return value.split(/[\s,]+/).map(normaliseHost).filter(Boolean);
}

// `--name` and `--name=value`, as Chromium and process.argv both carry them.
function readSwitch(argv, name) {
    for (const arg of argv) {
        if (typeof arg !== 'string') continue;
        if (arg === `--${name}`) return '';
        if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
    }
    return null;
}

/**
 * Read the guard settings from the environment and the command line.
 *
 * @param {{ env?: Record<string, string|undefined>, argv?: string[] }} params
 * @returns {{ on: boolean, probe: boolean, allowed: Set<string> }}
 */
export function readGuardConfig({ env = {}, argv = [] } = {}) {
    const envOn = TRUTHY.has(String(env[GUARD_ENV] ?? '').trim().toLowerCase());
    const switchValue = readSwitch(argv, GUARD_SWITCH);
    const switchOn = switchValue !== null
        && (switchValue === '' || TRUTHY.has(switchValue.trim().toLowerCase()));
    const probe = readSwitch(argv, PROBE_SWITCH) !== null;
    const allowed = new Set(LOOPBACK_HOSTS);
    for (const host of parseHostList(env[ALLOW_ENV])) allowed.add(host);
    for (const host of parseHostList(readSwitch(argv, ALLOW_SWITCH) ?? '')) allowed.add(host);
    return { on: envOn || switchOn || probe, probe, allowed };
}

/**
 * @param {unknown} host
 * @param {Set<string>} allowed  normalised hosts
 * @returns {boolean}
 */
export function isHostAllowed(host, allowed) {
    return allowed.has(normaliseHost(host));
}

/**
 * Decide one Chromium request. Only schemes that leave the machine are
 * checked; an unparseable URL is refused.
 *
 * @param {string} url
 * @param {Set<string>} allowed
 * @returns {{ allow: true } | { allow: false, host: string, shown: string }}
 */
export function decideRequest(url, allowed) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { allow: false, host: '', shown: '(unparseable url)' };
    }
    if (!NETWORK_PROTOCOLS.has(parsed.protocol)) return { allow: true };
    if (isHostAllowed(parsed.hostname, allowed)) return { allow: true };
    // Scheme, host and path only: a query string can carry addresses.
    return {
        allow: false,
        host: normaliseHost(parsed.hostname),
        shown: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    };
}

/**
 * Where a net.Socket#connect call is headed. Covers the public forms
 * (options, port+host, path) and the normalised [options, cb] array that
 * net.connect and tls.connect hand to it.
 *
 * @param {unknown[]} args
 * @returns {{ ipc: true } | { ipc: false, host: string, port: unknown }}
 */
export function connectTarget(args) {
    let first = args[0];
    if (Array.isArray(first)) first = first[0];
    if (first && typeof first === 'object') {
        if (first.path) return { ipc: true };
        return { ipc: false, host: first.host ?? 'localhost', port: first.port };
    }
    if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
        return { ipc: false, host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
    }
    if (typeof first === 'string') return { ipc: true };
    return { ipc: false, host: 'localhost', port: undefined };
}

// The live guard for this process, read by networkGuardRefusal().
let active = null;

function refusalError(host, port) {
    const err = new Error(`network guard refused a connection to ${host}${port !== undefined ? `:${port}` : ''}`);
    err.code = REFUSAL_CODE;
    return err;
}

/**
 * For code that tunnels a destination through an allowed hop (the SOCKS
 * client): the error to fail with, or null when the guard is off or the
 * host is allowed.
 *
 * @param {string} host
 * @param {number} [port]
 * @returns {Error | null}
 */
export function networkGuardRefusal(host, port) {
    if (!active || isHostAllowed(host, active.allowed)) return null;
    active.refuse('socks', `${host}${port !== undefined ? `:${port}` : ''}`);
    return refusalError(host, port);
}

/**
 * Wrap net.Socket#connect so a connection to a host outside `allowed`
 * fails with REFUSAL_CODE before any lookup. Returns the undo.
 *
 * @param {{ Socket: { prototype: { connect: Function } }, allowed: Set<string>, refuse: (kind: string, target: string) => void }} params
 * @returns {() => void}
 */
export function installSocketGuard({ Socket, allowed, refuse }) {
    const original = Socket.prototype.connect;
    function guardedConnect(...args) {
        const target = connectTarget(args);
        if (!target.ipc && !isHostAllowed(target.host, allowed)) {
            refuse('node', `${target.host}${target.port !== undefined ? `:${target.port}` : ''}`);
            const err = refusalError(target.host, target.port);
            // Async, as a real connect failure is: callers attach their
            // 'error' listener after connect() returns.
            process.nextTick(() => this.destroy(err));
            return this;
        }
        return original.apply(this, args);
    }
    Socket.prototype.connect = guardedConnect;
    return () => {
        if (Socket.prototype.connect === guardedConnect) Socket.prototype.connect = original;
    };
}

/**
 * Cancel every Chromium request in `session` whose host is not allowed.
 * Idempotent per session.
 *
 * @param {{ webRequest: { onBeforeRequest: Function } }} session
 * @param {{ allowed: Set<string>, refuse: (kind: string, target: string) => void, attached?: WeakSet<object> }} params
 * @returns {boolean} true when this call attached the filter
 */
export function attachSessionGuard(session, { allowed, refuse, attached }) {
    if (!session?.webRequest?.onBeforeRequest) return false;
    if (attached?.has(session)) return false;
    session.webRequest.onBeforeRequest((details, callback) => {
        const verdict = decideRequest(details.url, allowed);
        if (verdict.allow) {
            callback({});
            return;
        }
        refuse('chromium', verdict.shown);
        callback({ cancel: true });
    });
    attached?.add(session);
    return true;
}

/**
 * Turn the guard on when the environment or command line asks for it.
 * Call at module scope in the main entry, before app ready: the socket
 * wrap and the startup line happen here, the session filters at
 * `session-created` and again through attachSession(defaultSession).
 *
 * @param {Object} params
 * @param {{ on: Function }} params.app                  Electron app
 * @param {{ prototype: { connect: Function } }} params.Socket  node:net Socket
 * @param {Record<string, string|undefined>} params.env
 * @param {string[]} params.argv
 * @param {(line: string) => void} [params.log]
 */
export function installNetworkGuard({ app, Socket, env, argv, log: print = (line) => console.info(line) }) {
    const config = readGuardConfig({ env, argv });
    if (!config.on) {
        return {
            on: false, probe: false, allowed: config.allowed, refusals: [], lines: [],
            attachSession: () => false, uninstall: () => {},
        };
    }
    // Every guard line, in order, kept in-process: a harness reads it back
    // through app.evaluate, since output printed before it attached to the
    // process pipes is gone by then.
    const lines = [];
    const log = (line) => {
        lines.push(line);
        print(line);
    };
    const refusals = [];
    const refuse = (kind, target) => {
        refusals.push({ kind, target });
        log(`${LOG_PREFIX} refused ${kind} ${target}`);
    };
    const attached = new WeakSet();
    const attachSession = (session, label = 'session') => {
        const added = attachSessionGuard(session, { allowed: config.allowed, refuse, attached });
        if (added) log(`${LOG_PREFIX} filtering ${label} requests`);
        return added;
    };

    const undoSocket = installSocketGuard({ Socket, allowed: config.allowed, refuse });
    const mine = { allowed: config.allowed, refuse };
    active = mine;
    const shown = [...config.allowed].map((h) => (h.includes(':') ? `[${h}]` : h)).join(', ');
    log(`${GUARD_ON_TEXT} only ${shown} may be reached; every other host is refused`);

    app.on('session-created', (session) => attachSession(session, 'new session'));
    let windowSeen = false;
    app.on('browser-window-created', () => {
        if (windowSeen) return;
        windowSeen = true;
        log(FIRST_WINDOW_TEXT);
    });

    // For tests: the socket wrap and the SOCKS check come off; session
    // filters stay, as Electron has no way to remove one listener.
    const uninstall = () => {
        undoSocket();
        if (active === mine) active = null;
    };

    return { on: true, probe: config.probe, allowed: config.allowed, refusals, lines, attachSession, uninstall };
}

// One attempt, settled within `ms`: 'reached' if anything answered.
async function attempt(label, run, ms = 10_000) {
    let timer;
    try {
        await Promise.race([
            run(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); }),
        ]);
        return { label, reached: true, detail: 'answered' };
    } catch (err) {
        return { label, reached: false, detail: String(err?.cause?.code ?? err?.code ?? err?.message ?? err) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Probe mode: try each egress path against a reserved host and check the
 * guard, not DNS, is what stopped it. Logs one line per path and a
 * verdict; resolves true when every path was refused by the guard.
 *
 * @param {{ refusals: Array<{kind: string, target: string}> }} guard
 * @param {{ netFetch: (url: string) => Promise<unknown>, https: typeof import('node:https'), fetchImpl?: typeof fetch, log?: (line: string) => void }} deps
 * @returns {Promise<boolean>}
 */
export async function runNetworkGuardProbe(guard, { netFetch, https, fetchImpl = globalThis.fetch, log = (line) => console.info(line) }) {
    const host = new URL(PROBE_URL).hostname;
    const paths = [
        { kind: 'node', label: 'node fetch', run: () => fetchImpl(PROBE_URL) },
        {
            kind: 'node',
            label: 'node https',
            run: () => new Promise((resolve, reject) => {
                const req = https.get(PROBE_URL, (res) => { res.resume(); resolve(res); });
                req.on('error', reject);
            }),
        },
        { kind: 'chromium', label: 'chromium net.fetch', run: () => netFetch(PROBE_URL) },
    ];
    let pass = true;
    for (const path of paths) {
        const before = guard.refusals.filter((r) => r.kind === path.kind && r.target.includes(host)).length;
        // eslint-disable-next-line no-await-in-loop
        const result = await attempt(path.label, path.run);
        const after = guard.refusals.filter((r) => r.kind === path.kind && r.target.includes(host)).length;
        const refused = !result.reached && after > before;
        if (!refused) pass = false;
        log(`${LOG_PREFIX} probe ${path.label}: ${refused ? 'refused' : `NOT refused by the guard (${result.detail})`}`);
    }
    log(`${LOG_PREFIX} probe ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
}
