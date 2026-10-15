/**
 * @vitest-environment node
 *
 * Node, not jsdom: this is Electron main-process code, and the socket
 * cases open real sockets. Every real attempt targets an RFC 2606 .invalid
 * host, so a broken guard fails on DNS here and never reaches a service.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The test network guard: two desktop test runs reached hub.xchain.io and
// explorer.xchain.io because their network block rode in NODE_OPTIONS,
// which Playwright's electron.launch drops. These cases pin what the
// guard decides, that it is off unless asked for, and that a refused Node
// connection fails with the guard's own code before any DNS lookup.

import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import {
    ALLOW_ENV,
    FIRST_WINDOW_TEXT,
    GUARD_ENV,
    GUARD_ON_TEXT,
    PROBE_URL,
    REFUSAL_CODE,
    attachSessionGuard,
    connectTarget,
    decideRequest,
    installNetworkGuard,
    networkGuardRefusal,
    readGuardConfig,
    runNetworkGuardProbe,
} from '../../../packages/desktop/main/networkGuard.js';
import { socksConnect } from '../../../packages/desktop/main/socksAgent.js';

const LOOPBACK = readGuardConfig({}).allowed;
const BLOCKED = 'network-guard-unit.invalid';

function fakeApp() {
    const handlers = {};
    return {
        handlers,
        on(event, fn) { (handlers[event] ||= []).push(fn); },
        emit(event, ...args) { for (const fn of handlers[event] || []) fn(...args); },
    };
}

function fakeSession() {
    const s = { listener: null, webRequest: { onBeforeRequest(fn) { s.listener = fn; } } };
    s.decide = (url) => new Promise((resolve) => { s.listener({ url }, resolve); });
    return s;
}

let guards = [];
function install(env, argv = []) {
    const lines = [];
    const app = fakeApp();
    const guard = installNetworkGuard({ app, Socket: net.Socket, env, argv, log: (l) => lines.push(l) });
    guards.push(guard);
    return { guard, lines, app };
}

afterEach(() => {
    for (const g of guards) g.uninstall();
    guards = [];
});

describe('readGuardConfig', () => {
    it('is off with nothing set', () => {
        expect(readGuardConfig({ env: {}, argv: ['electron', '.'] }).on).toBe(false);
        expect(readGuardConfig({ env: { [GUARD_ENV]: '0' } }).on).toBe(false);
        expect(readGuardConfig({ argv: ['--xchain-test-network-guard=0'] }).on).toBe(false);
    });

    it('turns on from the variable or the switch', () => {
        expect(readGuardConfig({ env: { [GUARD_ENV]: '1' } }).on).toBe(true);
        expect(readGuardConfig({ env: { [GUARD_ENV]: 'true' } }).on).toBe(true);
        expect(readGuardConfig({ argv: ['.', '--xchain-test-network-guard'] }).on).toBe(true);
        expect(readGuardConfig({ argv: ['--xchain-test-network-guard=1'] }).on).toBe(true);
    });

    it('probe mode implies the guard', () => {
        const c = readGuardConfig({ argv: ['--xchain-test-network-guard-probe'] });
        expect(c).toMatchObject({ on: true, probe: true });
    });

    it('allows loopback always, plus named regtest hosts', () => {
        expect([...LOOPBACK].sort()).toEqual(['127.0.0.1', '::1', 'localhost']);
        const c = readGuardConfig({
            env: { [ALLOW_ENV]: 'Regtest-A.example, regtest-b.example.' },
            argv: ['--xchain-test-network-guard-allow=[fd00::5],regtest-c.example'],
        });
        for (const h of ['regtest-a.example', 'regtest-b.example', 'fd00::5', 'regtest-c.example', 'localhost']) {
            expect(c.allowed.has(h)).toBe(true);
        }
    });
});

describe('decideRequest', () => {
    it('refuses mainnet services, without the query string in the log', () => {
        expect(decideRequest('https://hub.xchain.io/api/v1/state?address=1abc', LOOPBACK)).toEqual({
            allow: false, host: 'hub.xchain.io', shown: 'https://hub.xchain.io/api/v1/state',
        });
        expect(decideRequest('wss://explorer.xchain.io/ws', LOOPBACK).allow).toBe(false);
        expect(decideRequest('http://HUB.XCHAIN.IO./', LOOPBACK).allow).toBe(false);
    });

    it('allows this machine on any port', () => {
        for (const url of ['http://localhost:5840/', 'http://127.0.0.1:10000/x', 'http://[::1]:18080/', 'ws://localhost:9222/devtools']) {
            expect(decideRequest(url, LOOPBACK)).toEqual({ allow: true });
        }
    });

    it('allows a configured regtest host and nothing beside it', () => {
        const allowed = readGuardConfig({ env: { [ALLOW_ENV]: 'regtest.example' } }).allowed;
        expect(decideRequest('https://regtest.example/api', allowed).allow).toBe(true);
        expect(decideRequest('https://hub.regtest.example/api', allowed).allow).toBe(false);
    });

    it('leaves schemes that never leave the machine alone', () => {
        for (const url of ['file:///app/index.html', 'data:text/plain,x', 'devtools://devtools/x', 'blob:file:///abc', 'chrome-extension://abc/x']) {
            expect(decideRequest(url, LOOPBACK).allow).toBe(true);
        }
    });

    it('refuses what it cannot parse', () => {
        expect(decideRequest('not a url', LOOPBACK).allow).toBe(false);
    });
});

describe('connectTarget', () => {
    it('reads every net.Socket#connect form', () => {
        expect(connectTarget([{ host: 'a.example', port: 443 }])).toEqual({ ipc: false, host: 'a.example', port: 443 });
        expect(connectTarget([[{ host: 'b.example', port: 80 }, () => {}]])).toEqual({ ipc: false, host: 'b.example', port: 80 });
        expect(connectTarget([443, 'c.example'])).toEqual({ ipc: false, host: 'c.example', port: 443 });
        expect(connectTarget(['8080'])).toEqual({ ipc: false, host: 'localhost', port: '8080' });
        expect(connectTarget([{ port: 1 }])).toMatchObject({ host: 'localhost' });
        expect(connectTarget(['/tmp/x.sock'])).toEqual({ ipc: true });
        expect(connectTarget([{ path: '/tmp/x.sock' }])).toEqual({ ipc: true });
    });
});

describe('attachSessionGuard', () => {
    it('cancels a refused request and passes an allowed one', async () => {
        const refused = [];
        const s = fakeSession();
        expect(attachSessionGuard(s, { allowed: LOOPBACK, refuse: (k, t) => refused.push([k, t]) })).toBe(true);
        expect(await s.decide('https://hub.xchain.io/')).toEqual({ cancel: true });
        expect(await s.decide('http://127.0.0.1:5840/')).toEqual({});
        expect(await s.decide('file:///index.html')).toEqual({});
        expect(refused).toEqual([['chromium', 'https://hub.xchain.io/']]);
    });

    it('attaches once per session', () => {
        const attached = new WeakSet();
        const s = fakeSession();
        expect(attachSessionGuard(s, { allowed: LOOPBACK, refuse: () => {}, attached })).toBe(true);
        expect(attachSessionGuard(s, { allowed: LOOPBACK, refuse: () => {}, attached })).toBe(false);
    });
});

describe('installNetworkGuard', () => {
    it('does nothing when not asked for', () => {
        const before = net.Socket.prototype.connect;
        const { guard, lines, app } = install({});
        expect(guard.on).toBe(false);
        expect(net.Socket.prototype.connect).toBe(before);
        expect(lines).toEqual([]);
        expect(app.handlers).toEqual({});
        expect(networkGuardRefusal('hub.xchain.io', 443)).toBeNull();
    });

    it('prints the startup line first, then filters sessions and marks the first window', () => {
        const { guard, lines, app } = install({ [GUARD_ENV]: '1' });
        expect(guard.on).toBe(true);
        expect(lines[0]).toContain(GUARD_ON_TEXT);
        expect(lines[0]).toContain('localhost, 127.0.0.1, [::1]');
        const s = fakeSession();
        app.emit('session-created', s);
        expect(typeof s.listener).toBe('function');
        expect(guard.attachSession(s, 'default session')).toBe(false);
        app.emit('browser-window-created');
        app.emit('browser-window-created');
        expect(lines.filter((l) => l === FIRST_WINDOW_TEXT)).toHaveLength(1);
    });

    it('refuses a Node https request before DNS, with its own code', async () => {
        const { guard, lines } = install({ [GUARD_ENV]: '1' });
        const err = await new Promise((resolve) => {
            https.get(`https://${BLOCKED}/`, () => resolve(null)).on('error', resolve);
        });
        expect(err?.code).toBe(REFUSAL_CODE);
        expect(guard.refusals).toContainEqual({ kind: 'node', target: `${BLOCKED}:443` });
        expect(lines.some((l) => l.includes(`refused node ${BLOCKED}:443`))).toBe(true);
    });

    it('refuses Node fetch (undici) too', async () => {
        install({ [GUARD_ENV]: '1' });
        const err = await fetch(`https://${BLOCKED}/`).then(() => null, (e) => e);
        expect(err?.cause?.code).toBe(REFUSAL_CODE);
    });

    it('still lets loopback through', async () => {
        install({ [GUARD_ENV]: '1' });
        const server = http.createServer((_req, res) => res.end('ok'));
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        try {
            const { port } = server.address();
            const res = await fetch(`http://127.0.0.1:${port}/`);
            expect(await res.text()).toBe('ok');
        } finally {
            await new Promise((r) => server.close(r));
        }
    });

    it('refuses a SOCKS tunnel to a refused host without dialling the proxy', async () => {
        const { guard } = install({ [GUARD_ENV]: '1' });
        const err = await socksConnect({ proxyHost: '127.0.0.1', proxyPort: 9, host: 'hub.xchain.io', port: 443 })
            .then(() => null, (e) => e);
        expect(err?.code).toBe(REFUSAL_CODE);
        expect(guard.refusals).toContainEqual({ kind: 'socks', target: 'hub.xchain.io:443' });
    });

    it('comes off cleanly', async () => {
        const before = net.Socket.prototype.connect;
        const { guard } = install({ [GUARD_ENV]: '1' });
        expect(net.Socket.prototype.connect).not.toBe(before);
        guard.uninstall();
        expect(net.Socket.prototype.connect).toBe(before);
        expect(networkGuardRefusal('hub.xchain.io', 443)).toBeNull();
    });
});

describe('runNetworkGuardProbe', () => {
    it('passes only when the guard refused every path', async () => {
        const { guard } = install({ [GUARD_ENV]: '1' });
        const s = fakeSession();
        guard.attachSession(s);
        const netFetch = (url) => s.decide(url).then((v) => {
            if (v.cancel) throw new Error('net::ERR_BLOCKED_BY_CLIENT');
            return v;
        });
        const lines = [];
        expect(await runNetworkGuardProbe(guard, { netFetch, https, log: (l) => lines.push(l) })).toBe(true);
        expect(lines.at(-1)).toMatch(/probe PASS$/);
        expect(PROBE_URL).toMatch(/\.invalid\/$/);
    });

    it('fails when a path is stopped by something other than the guard', async () => {
        const { guard } = install({ [GUARD_ENV]: '1' });
        const lines = [];
        const netFetch = () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'));
        expect(await runNetworkGuardProbe(guard, { netFetch, https, log: (l) => lines.push(l) })).toBe(false);
        expect(lines.at(-1)).toMatch(/probe FAIL$/);
    });
});
