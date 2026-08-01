// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SOCKS5 routing for the desktop shell .
//
// WHY THIS EXISTS. Settings has offered a "Tor routing" toggle since
// before this file: "Route SDK requests through a local Tor SOCKS5
// proxy when available." Nothing consumed the setting. A user who
// turned it on was told their traffic was anonymised while every
// explorer, encoder and hub request went straight out from their own IP
// carrying the addresses they watch. That is worse than a missing
// feature; it is a privacy claim the product made and the code did not
// keep.
//
// DESKTOP ONLY, AND THAT IS NOT A SHORTCUT. A web page cannot speak
// SOCKS at all: the browser owns the socket and exposes no proxy API to
// script. An MV3 extension could call `chrome.proxy`, but that sets the
// proxy for the ENTIRE browser, not for the extension's own requests,
// so turning on a wallet setting would silently reroute the user's
// unrelated browsing. Neither is a thing we can honestly ship, so the
// toggle is shown only where it works (see PrivacySection).
//
// NO DEPENDENCY. SOCKS5 CONNECT is a short, fully specified handshake
// (RFC 1928) and this is a wallet, so a hand-rolled ~60 lines that can
// be read in one sitting beats another package in the trusted context.
//
// TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE:
//
//   1. NO DNS LEAK. The request uses ATYP 0x03 (domain name), so the
//      PROXY resolves the hostname. Resolving locally and sending
//      ATYP 0x01 would hand every hostname the wallet contacts to the
//      user's DNS resolver in cleartext, which defeats the entire point
//      while looking like it works.
//
//   2. FAIL CLOSED. If the proxy is missing, refusing, or broken, the
//      request FAILS. It never falls back to a direct connection. A
//      silent fallback would recreate the original bug in a subtler
//      form: the toggle would be on, the traffic would be direct, and
//      nothing would say so. The user sees an error instead, which is
//      the honest outcome and is also how they find out Tor is not
//      running.

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

/** Tor's default SOCKS port on localhost. */
export const DEFAULT_SOCKS = Object.freeze({ host: '127.0.0.1', port: 9050 });

/** How long the SOCKS handshake itself may take before we give up. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

const SOCKS5 = 0x05;
const NO_AUTH = 0x00;
const CMD_CONNECT = 0x01;
const ATYP_DOMAIN = 0x03;

// RFC 1928 §6 reply codes, in the words a user might act on.
const REPLY = Object.freeze({
    0x00: 'succeeded',
    0x01: 'general SOCKS server failure',
    0x02: 'connection not allowed by ruleset',
    0x03: 'network unreachable',
    0x04: 'host unreachable',
    0x05: 'connection refused',
    0x06: 'TTL expired',
    0x07: 'command not supported',
    0x08: 'address type not supported',
});

export class SocksError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SocksError';
    }
}

/**
 * Parse a user-supplied proxy address into { host, port }.
 * Accepts 'host:port', 'socks5://host:port', or an empty value for the
 * Tor default. Deliberately strict: a typo that silently became the
 * default would route traffic somewhere the user did not choose.
 *
 * @param {string} [value]
 * @returns {{ host: string, port: number }}
 */
export function parseSocksAddress(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return { ...DEFAULT_SOCKS };
    const stripped = raw.replace(/^socks5h?:\/\//i, '');
    const m = /^([^:/\s]+)(?::(\d{1,5}))?$/.exec(stripped);
    if (!m) throw new SocksError(`not a usable SOCKS address: ${raw}`);
    const port = m[2] ? Number(m[2]) : DEFAULT_SOCKS.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new SocksError(`SOCKS port out of range: ${raw}`);
    }
    return { host: m[1], port };
}

/**
 * Open a TCP tunnel to `host:port` through the SOCKS5 proxy.
 * Resolves with a connected socket; rejects on any failure.
 *
 * @param {Object} params
 * @param {string} params.proxyHost
 * @param {number} params.proxyPort
 * @param {string} params.host   destination hostname, resolved BY THE PROXY
 * @param {number} params.port
 * @param {number} [params.timeoutMs]
 * @returns {Promise<import('node:net').Socket>}
 */
export function socksConnect({
    proxyHost, proxyPort, host, port, timeoutMs = HANDSHAKE_TIMEOUT_MS,
}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const socket = net.connect(proxyPort, proxyHost);

        const fail = (err) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            reject(err instanceof Error ? err : new SocksError(String(err)));
        };
        const done = () => {
            if (settled) return;
            settled = true;
            socket.setTimeout(0);
            socket.removeListener('error', fail);
            resolve(socket);
        };

        socket.setTimeout(timeoutMs, () => fail(new SocksError(
            `SOCKS proxy at ${proxyHost}:${proxyPort} did not answer in ${timeoutMs}ms`)));
        socket.once('error', (err) => fail(new SocksError(
            `cannot reach the SOCKS proxy at ${proxyHost}:${proxyPort}: ${err.message}`)));

        socket.once('connect', () => {
            // Greeting: version, one method, "no authentication".
            socket.write(Buffer.from([SOCKS5, 0x01, NO_AUTH]));

            socket.once('data', (greeting) => {
                if (greeting[0] !== SOCKS5) {
                    return fail(new SocksError('not a SOCKS5 proxy'));
                }
                if (greeting[1] !== NO_AUTH) {
                    // Tor's default needs no auth. A proxy demanding it is
                    // not the one the user thinks they are pointed at, and
                    // guessing credentials is not a thing to do quietly.
                    return fail(new SocksError(
                        'the SOCKS proxy requires authentication, which is not configured'));
                }

                const name = Buffer.from(host, 'utf8');
                if (name.length > 255) return fail(new SocksError('hostname too long for SOCKS5'));
                socket.write(Buffer.concat([
                    Buffer.from([SOCKS5, CMD_CONNECT, 0x00, ATYP_DOMAIN, name.length]),
                    name,
                    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                ]));

                socket.once('data', (reply) => {
                    if (reply[0] !== SOCKS5) return fail(new SocksError('malformed SOCKS5 reply'));
                    if (reply[1] !== 0x00) {
                        const why = REPLY[reply[1]] ?? `unknown error 0x${reply[1].toString(16)}`;
                        return fail(new SocksError(`SOCKS proxy refused ${host}:${port}: ${why}`));
                    }
                    done();
                });
            });
        });
    });
}

/**
 * Build the agents every outbound path in the main process needs.
 *
 * @param {{ host: string, port: number }} proxy
 * @returns {{ httpAgent: import('node:http').Agent, httpsAgent: import('node:https').Agent, connect: Function }}
 */
export function createSocksAgents(proxy) {
    const { host: proxyHost, port: proxyPort } = proxy;

    const dial = (opts) => socksConnect({
        proxyHost, proxyPort, host: opts.host, port: Number(opts.port),
    });

    class SocksHttpAgent extends http.Agent {
        createConnection(opts, cb) {
            dial(opts).then((s) => cb(null, s)).catch(cb);
        }
    }

    class SocksHttpsAgent extends https.Agent {
        createConnection(opts, cb) {
            dial(opts).then((sock) => {
                // TLS runs INSIDE the tunnel, terminated at the real host.
                // `servername` is the true destination, so certificate
                // validation is unchanged and the proxy sees only
                // ciphertext. Certificate checking is never relaxed here:
                // an anonymising proxy that could also read the traffic
                // would be a worse deal than no proxy at all.
                const secure = tls.connect({
                    socket: sock,
                    servername: opts.servername || opts.host,
                });
                secure.once('secureConnect', () => cb(null, secure));
                secure.once('error', (err) => cb(err));
            }).catch(cb);
        }
    }

    // Node's global `fetch` is undici, which ignores http.Agent entirely.
    // It takes a custom `connect` instead, so the same tunnel covers
    // fetch-based traffic (price lookups, token metadata) rather than
    // leaving it to leak around the proxied SDK.
    const connect = (opts, cb) => {
        dial({ host: opts.hostname, port: opts.port || (opts.protocol === 'http:' ? 80 : 443) })
            .then((sock) => {
                if (opts.protocol !== 'https:') return cb(null, sock);
                const secure = tls.connect({
                    socket: sock,
                    servername: opts.servername || opts.hostname,
                });
                secure.once('secureConnect', () => cb(null, secure));
                secure.once('error', (err) => cb(err));
            })
            .catch(cb);
    };

    return {
        httpAgent: new SocksHttpAgent({ keepAlive: true, maxSockets: 10 }),
        httpsAgent: new SocksHttpsAgent({ keepAlive: true, maxSockets: 10 }),
        connect,
    };
}

/**
 * Probe whether the proxy is actually there.
 *
 * Worth doing at the moment the user flips the toggle rather than at the
 * moment they next send a transaction: "Tor is not running" is useful in
 * Settings and alarming in a signing flow.
 *
 * @param {{ host: string, port: number }} proxy
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function probeSocks(proxy) {
    try {
        // Tor answers a CONNECT to its own control-free check host, but any
        // reachable destination proves the proxy speaks SOCKS5. Use the
        // proxy's own loopback so the probe never leaves the machine.
        const sock = await socksConnect({
            proxyHost: proxy.host,
            proxyPort: proxy.port,
            host: 'localhost',
            port: proxy.port,
            timeoutMs: 3_000,
        });
        sock.destroy();
        return { ok: true };
    } catch (err) {
        // A refusal from a live proxy still proves it is a live proxy: it
        // spoke SOCKS5 well enough to say no.
        if (err instanceof SocksError && /refused .*:/.test(err.message)) return { ok: true };
        return { ok: false, reason: err.message };
    }
}
