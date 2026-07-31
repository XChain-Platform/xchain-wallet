// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural: Developer-Mode localhost auto-sign (Cluster Q FOLLOWUP 3).
//
// Drives bridge.signMessage + bridge.signAction through a real MessageHost.
// The two terminal signing flows (signMessageFlow, sendToken) are mocked so
// the test can observe the password each flow receives without a real seed /
// SDK. Everything else - the handler wiring, shouldAutoApproveSign, and the
// signPasswordCache - runs for real.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted above imports; the spies must be hoisted too so the
// factory can close over them.
const { signMessageFlow, sendToken } = vi.hoisted(() => ({
    signMessageFlow: vi.fn(),
    sendToken: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, signMessageFlow, sendToken },
    };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');
const { createSignPasswordCache } = await import('../../../packages/extension/src/bridge/signPasswordCache.js');
const { AUTO_SIGN_LOCALHOST_5M } = await import('../../../packages/core/src/schemas/settings.js');

const ORIGIN = 'http://localhost:5173';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';

const DESCRIPTORS = {
    [CHAIN]: { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' },
};
const chainRegistry = {
    get: (id) => DESCRIPTORS[id] ?? null,
    descriptorFor: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
    chainIdFor: () => CHAIN,
};

// A connected site pre-granted for the chain/account, with SEND allowed via
// the 'ask' policy (so the flow is reached once approved).
function connectedSite() {
    return {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'dev dApp',
        permissions: {
            chains: [CHAIN],
            accounts: [],           // empty = all accounts permitted (§43.3)
            canSignMessage: false,
            canSignAction: { SEND: 'ask' },
        },
    };
}

function makeVault({ autoSignLocalhostMs, developerMode = true, origin = ORIGIN } = {}) {
    const sites = new Map([['site-1', { ...connectedSite(), origin }]]);
    return {
        settings: {
            get: async () => ({
                developerMode,
                autoSignLocalhostMs,
                activeNetwork: 'regtest',
                fees: { [CHAIN]: {} },
                blockedOrigins: [],
            }),
        },
        addresses: {
            list: async () => [
                { id: 'addr-1', address: FROM, chain: 'bitcoin', network: 'regtest', accountId: 'acct-1' },
            ],
        },
        accounts: {
            list: async () => [{ id: 'acct-1', name: 'A1', walletId: 'wallet-1' }],
            get: async (id) => (id === 'acct-1' ? { id: 'acct-1', walletId: 'wallet-1' } : null),
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        connectedSites: {
            list: async () => [...sites.values()],
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
            delete: async (id) => { sites.delete(id); },
        },
    };
}

// approvals stub that counts prompts and returns a fresh decision each time.
function countingApprovals(password = 'user-password') {
    const calls = { signMessage: 0, signAction: 0 };
    return {
        _calls: calls,
        signMessage: async () => { calls.signMessage += 1; return { approved: true, password, walletId: 'wallet-1' }; },
        signAction: async () => { calls.signAction += 1; return { approved: true, password, walletId: 'wallet-1' }; },
    };
}

// A permissive throttle so rate-limiting never interferes.
const okThrottle = { check: () => ({ allowed: true }) };

function buildHost(vault, approvals, { signPasswordCache } = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals, signThrottle: okThrottle, signPasswordCache });
    return host;
}

beforeEach(() => {
    signMessageFlow.mockReset().mockImplementation(async (args) => ({ signature: 'sig', usedPassword: args.password }));
    sendToken.mockReset().mockImplementation(async (args) => ({ txid: 'tx', usedPassword: args.password }));
});

// handlers.js destructures `flows` from '@xchain-wallet/core' at module
// scope, so the mock above only lands if handlers.js resolves that
// specifier to the same file this test mocked. When it does not, vi.mock is
// a silent no-op and the real signing flows run: the spies stay at zero and
// the failures read as bridge bugs. Assert the wiring once, up front, so a
// resolution drift names itself .
// Deliberately reached by relative path, not by the specifier the mock is
// keyed on: that is the whole point. This path can only mean core in THIS
// checkout, so if the bare specifier resolved anywhere else the two are
// different modules and the identity check fails here, loudly, instead of
// six assertions later.
it('the @xchain-wallet/core mock covers this checkout\'s core', async () => {
    const core = await import('../../../packages/core/src/index.js');
    expect(
        core.flows.signMessageFlow,
        '@xchain-wallet/core resolved to a different copy of core than this repo\'s '
        + 'packages/core, so vi.mock never reached the bridge handlers '
        + '(check test/vitest/workspaceAlias.js and node_modules/@xchain-wallet)',
    ).toBe(signMessageFlow);
    expect(core.flows.sendToken).toBe(sendToken);
});

describe('bridge.signMessage: localhost auto-sign reuses the cached password', () => {
    it('prompts once, then auto-signs subsequent requests from cache', async () => {
        const vault = makeVault({ autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M });
        const approvals = countingApprovals('pw1');
        const host = buildHost(vault, approvals);

        const first = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hello' },
        });
        expect(first.ok).toBe(true);
        expect(approvals._calls.signMessage).toBe(1);
        expect(signMessageFlow).toHaveBeenCalledTimes(1);
        expect(signMessageFlow.mock.calls[0][0].password).toBe('pw1');

        // Second request: no prompt, cached password reused.
        const second = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'world' },
        });
        expect(second.ok).toBe(true);
        expect(approvals._calls.signMessage, 'no second prompt').toBe(1);
        expect(signMessageFlow).toHaveBeenCalledTimes(2);
        expect(signMessageFlow.mock.calls[1][0].password).toBe('pw1');
    });

    it('always prompts when auto-sign is off (never caches)', async () => {
        const vault = makeVault({ autoSignLocalhostMs: 0 });
        const approvals = countingApprovals('pw1');
        const host = buildHost(vault, approvals);

        await host.handle({ type: 'bridge.signMessage', request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'a' } });
        await host.handle({ type: 'bridge.signMessage', request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'b' } });
        expect(approvals._calls.signMessage).toBe(2);
    });

    it('always prompts for a non-localhost origin even with auto-sign on', async () => {
        const nonLocal = 'https://app.example';
        const vault = makeVault({ autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M, origin: nonLocal });
        const approvals = countingApprovals('pw1');
        const host = buildHost(vault, approvals);

        await host.handle({ type: 'bridge.signMessage', request: { origin: nonLocal, chainId: CHAIN, address: FROM, message: 'a' } });
        await host.handle({ type: 'bridge.signMessage', request: { origin: nonLocal, chainId: CHAIN, address: FROM, message: 'b' } });
        expect(approvals._calls.signMessage).toBe(2);
    });

    it('re-prompts once the cached password has expired', async () => {
        let t = 0;
        const cache = createSignPasswordCache({ now: () => t });
        const vault = makeVault({ autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M });
        const approvals = countingApprovals('pw1');
        const host = buildHost(vault, approvals, { signPasswordCache: cache });

        await host.handle({ type: 'bridge.signMessage', request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'a' } });
        expect(approvals._calls.signMessage).toBe(1);

        // Advance past the 5-minute TTL: the cache entry is gone, so we prompt.
        t = AUTO_SIGN_LOCALHOST_5M + 1;
        await host.handle({ type: 'bridge.signMessage', request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'b' } });
        expect(approvals._calls.signMessage, 'expired cache re-prompts').toBe(2);
    });
});

describe('bridge.signAction: localhost auto-sign reuses the cached password', () => {
    it('prompts once, then auto-signs the next SEND from cache', async () => {
        const vault = makeVault({ autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M });
        const approvals = countingApprovals('pw2');
        const host = buildHost(vault, approvals);

        const send = (memo) => host.handle({
            type: 'bridge.signAction',
            request: { origin: ORIGIN, chainId: CHAIN, action: 'SEND', params: { from: FROM, to: 'bcrt1qto', amount: '1', memo } },
        });

        const first = await send('one');
        expect(first.ok).toBe(true);
        expect(approvals._calls.signAction).toBe(1);
        expect(sendToken).toHaveBeenCalledTimes(1);
        expect(sendToken.mock.calls[0][0].password).toBe('pw2');
        expect(sendToken.mock.calls[0][0].walletId).toBe('wallet-1');

        const second = await send('two');
        expect(second.ok).toBe(true);
        expect(approvals._calls.signAction, 'no second prompt').toBe(1);
        expect(sendToken).toHaveBeenCalledTimes(2);
        expect(sendToken.mock.calls[1][0].password).toBe('pw2');
    });

    it('does not cache when auto-sign is off', async () => {
        const vault = makeVault({ autoSignLocalhostMs: 0 });
        const approvals = countingApprovals('pw2');
        const host = buildHost(vault, approvals);
        const send = () => host.handle({
            type: 'bridge.signAction',
            request: { origin: ORIGIN, chainId: CHAIN, action: 'SEND', params: { from: FROM, to: 'bcrt1qto', amount: '1' } },
        });
        await send();
        await send();
        expect(approvals._calls.signAction).toBe(2);
    });

    it('a signMessage approval seeds the cache reused by a later signAction (shared per-wallet password)', async () => {
        const vault = makeVault({ autoSignLocalhostMs: AUTO_SIGN_LOCALHOST_5M });
        const approvals = countingApprovals('pw3');
        const host = buildHost(vault, approvals);

        await host.handle({ type: 'bridge.signMessage', request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hi' } });
        expect(approvals._calls.signMessage).toBe(1);

        const send = await host.handle({
            type: 'bridge.signAction',
            request: { origin: ORIGIN, chainId: CHAIN, action: 'SEND', params: { from: FROM, to: 'bcrt1qto', amount: '1' } },
        });
        expect(send.ok).toBe(true);
        // The action reused the message-approval password; no action prompt.
        expect(approvals._calls.signAction, 'action auto-signed from message-seeded cache').toBe(0);
        expect(sendToken.mock.calls[0][0].password).toBe('pw3');
    });
});
