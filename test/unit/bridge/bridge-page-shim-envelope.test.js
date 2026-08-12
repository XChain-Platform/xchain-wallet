// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Seen from the PAGE.
//
// The other bridge suites drive the MessageHost directly, which is one hop
// short of the thing that was broken: what a dApp gets is whatever survives
// the inject shim -> content-script relay -> background round trip, and the
// envelope was being assembled and then taken apart again across those hops.
//
// So this one runs the REAL `window.xchain` provider (the injected IIFE, in a
// jsdom page) against the REAL bridge handlers on a real MessageHost, with a
// relay standing in for the content script and doing exactly what it does:
// stamp the page origin on the request and post the response envelope back.
//
// The three things checked are the three the fix has to deliver at the page:
//
//   conn.ok             a successful connect is recognisable as one
//   sendResult.ok       so is a signed action
//   retryAfterMs        and a rate-limited call arrives as a RESOLVED
//                       THROTTLED result carrying the wait, not as a throw
//                       whose message a dApp would have to parse.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const { sendToken } = vi.hoisted(() => ({ sendToken: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken } };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');

const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';
const TO = 'bcrt1qtoaddress';

const DESCRIPTORS = {
    [CHAIN]: { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' },
};
const chainRegistry = {
    get: (id) => DESCRIPTORS[id] ?? null,
    descriptorFor: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
    chainIdFor: () => CHAIN,
};

const ACCOUNTS = [{ id: 'acct-primary', name: 'Primary', walletId: 'wallet-1' }];

function makeVault() {
    const sites = new Map();
    return {
        settings: {
            get: async () => ({
                developerMode: false,
                activeNetwork: 'regtest',
                fees: { [CHAIN]: {} },
                blockedOrigins: [],
            }),
        },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                address: FROM,
                chain: 'bitcoin',
                network: 'regtest',
                accountId: 'acct-primary',
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
                addressType: 'p2wpkh',
                label: 'Address #0',
            }],
        },
        accounts: {
            list: async () => ACCOUNTS.slice(),
            get: async (id) => ACCOUNTS.find((a) => a.id === id) ?? null,
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

const approvals = {
    connect: async () => ({
        approved: true,
        chains: [CHAIN],
        accounts: ['acct-primary'],
        canSignMessage: true,
        canSignAction: { SEND: 'ask' },
    }),
    signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    signMessage: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
};

// jsdom's window.postMessage delivers the event with `source: null`, and the
// provider's first guard is `if (event.source !== window) return` - the check
// that stops a cross-frame message from being treated as its own. So the relay
// answers with a MessageEvent it constructs, stamping `source: window` the way
// a real browser does. The provider's own outbound postMessage is left alone;
// the relay does not check `source`, the same as the content script.
function reply(id, payload) {
    window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'xchain-inject-response', id, ...payload },
        origin: window.location.origin,
        source: window,
    }));
}

// The content script, reduced to what it actually does for the page: refuse
// non-`bridge.*` types, stamp the page origin, hand the request to the
// background, post the response envelope back.
function installRelay(getHost) {
    const onMessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.source !== 'xchain-inject') return;
        if (typeof data.id !== 'string' || typeof data.type !== 'string') return;
        if (!data.type.startsWith('bridge.')) {
            reply(data.id, {
                ok: false,
                error: {
                    name: 'BridgeError',
                    message: 'FORBIDDEN: message type is not available to web pages',
                    code: 'INVALID_PARAMS',
                },
            });
            return;
        }
        getHost().handle({
            type: data.type,
            request: { ...(data.request ?? {}), origin: window.location.origin },
        }).then((response) => {
            reply(data.id, {
                ok: response.ok === true, result: response.result, error: response.error,
            });
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
}

// The provider defines `window.xchain` non-configurable, exactly as in a real
// page, so it is installed ONCE for the file and each case swaps the background
// behind it instead - which is also closer to the truth, since a page keeps one
// provider for its lifetime.
let provider = null;
let host = null;
let uninstallRelay = null;

function newHost({ signThrottle } = {}) {
    host = new MessageHost({ vault: makeVault(), chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, {
        approvals,
        signThrottle: signThrottle ?? { check: () => ({ allowed: true }) },
    });
    return host;
}

beforeAll(async () => {
    uninstallRelay = installRelay(() => host);
    await import('../../../packages/extension/src/inject/xchainProvider.js');
    provider = window.xchain;
});

afterAll(() => {
    if (uninstallRelay) uninstallRelay();
});

beforeEach(() => {
    sendToken.mockReset().mockResolvedValue({ txid: 'tx-page-1' });
    newHost();
});

describe('what the reference dApp sees through the real provider', () => {
    it('connect resolves an ok:true ConnectSuccess the example can branch on', async () => {
        const conn = await provider.connect({ appName: 'Example dApp', requestedChains: [CHAIN] });

        // The example's own first line: `if (!conn.ok) return report;`.
        expect(conn.ok).toBe(true);
        expect(conn.accounts).toEqual([{ id: 'acct-primary', name: 'Primary' }]);
        expect(conn.chains).toEqual([CHAIN]);
        expect(conn.permissions.accounts).toEqual(['acct-primary']);
        expect(typeof conn.version).toBe('string');
    });

    it('signAction resolves an ok:true SignActionSuccess carrying the txid', async () => {
        await provider.connect({ appName: 'Example dApp', requestedChains: [CHAIN] });

        const sendResult = await provider.signAction({
            chainId: CHAIN,
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amount: '0.0001' },
        });
        expect(sendResult.ok).toBe(true);
        expect(sendResult.txid).toBe('tx-page-1');
        expect(sendResult.chainId).toBe(CHAIN);
    });

    it('an unsupported action resolves the UnsupportedActionResult, listing what is supported', async () => {
        await provider.connect({ appName: 'Example dApp', requestedChains: [CHAIN] });

        const issueResult = await provider.signAction({
            chainId: CHAIN,
            action: 'ISSUE',
            params: { asset: 'NEWCOIN', quantity: '1000000', divisibility: 0 },
        });
        expect(issueResult.ok).toBe(false);
        expect(issueResult.error).toBe('UNSUPPORTED_ACTION');
        expect(issueResult.supportedActions).toEqual(['SEND', 'SWEEP']);
    });

    it('a throttled signAction resolves THROTTLED with the retry window attached', async () => {
        let allowed = true;
        newHost({
            signThrottle: {
                check: () => (allowed
                    ? { allowed: true }
                    : { allowed: false, retryAfterMs: 2500, burst: 4, windowMs: 60000 }),
            },
        });
        await provider.connect({ appName: 'Example dApp', requestedChains: [CHAIN] });
        allowed = false;

        const throttled = await provider.signAction({
            chainId: CHAIN,
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amount: '0.0001' },
        });
        // Resolved, not thrown: `signActionWithRetry` in the reference dApp
        // reads `err.retryAfterMs` off a RESULT and sleeps on it.
        expect(throttled.ok).toBe(false);
        expect(throttled.error).toBe('THROTTLED');
        expect(throttled.retryAfterMs).toBe(2500);
        expect(throttled.burst).toBe(4);
        expect(throttled.windowMs).toBe(60000);
    });

    it('a refusal on a result-union method resolves ok:false rather than throwing', async () => {
        // Not connected, so signMessage refuses; the page still gets a result.
        const refused = await provider.signMessage({
            chainId: CHAIN, address: FROM, message: 'hi',
        });
        expect(refused.ok).toBe(false);
        expect(refused.error).toBe('NOT_CONNECTED');
    });

    it('the bare-array reads still REJECT, as their published types require', async () => {
        // No connect happened, so getAccounts is refused. Its published type is
        // `Promise<Account[]>` with nowhere to put an ok flag.
        await expect(provider.getAccounts()).rejects.toThrow(/NOT_CONNECTED/);
    });
});
