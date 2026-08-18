// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural: the background handlers honour the contract bridge-spec
// publishes, driven through a real MessageHost.
//
// Four contract breaks lived here at once, each invisible to a source scan
// because in every case the handler read a name no published shape carries and
// the wrong value was `undefined` rather than an error:
//
// - connect stored `accounts: []`, which §43.3 reads as a
//                WILDCARD, so approving a chain handed the site every account.
// - connect read `req.chains` / `req.bridgeVersion` while
//                ConnectOpts publishes `requestedChains` /
//                `requiredBridgeVersion`, so preselection was dropped and
//                version negotiation never ran.
// - signAction forwarded SendActionParams' fromAddress /
//                toAddress / asset / amountRaw straight into sendToken, which
//                takes from / to / tick / amount.
// - bridge events were sent to a mutable tab id with no origin on
//                the message, so a tab navigating mid-fire got the previous
//                origin's accountsChanged.
//
// The terminal flow (sendToken) is mocked so the mapped opts can be observed
// without a real seed or SDK; every layer above it is the real one.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sendToken } = vi.hoisted(() => ({ sendToken: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken } };
});

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');
const { createBridgeEventBroadcaster } = await import('../../../packages/extension/src/bridge/bridgeEvents.js');

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';
const TO = 'bcrt1qtoaddress';

const DESCRIPTORS = {
    [CHAIN]: { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' },
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' },
};
const chainRegistry = {
    get: (id) => DESCRIPTORS[id] ?? null,
    descriptorFor: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
    chainIdFor: () => CHAIN,
};

// Two accounts, so "every account" and "the primary account" are
// distinguishable outcomes rather than the same one-element list.
const ACCOUNTS = [
    { id: 'acct-primary', name: 'Primary', walletId: 'wallet-1' },
    { id: 'acct-second', name: 'Second', walletId: 'wallet-1' },
];

function makeVault({ sites = [] } = {}) {
    const stored = new Map(sites.map((s) => [s.id, s]));
    return {
        _sites: stored,
        settings: {
            get: async () => ({
                developerMode: false,
                activeNetwork: 'regtest',
                fees: { [CHAIN]: {} },
                blockedOrigins: [],
            }),
        },
        addresses: {
            list: async () => [
                { id: 'addr-1', address: FROM, chain: 'bitcoin', network: 'regtest', accountId: 'acct-primary', publicKey: '02aa', derivationPath: "m/84'/1'/0'/0/0" },
                { id: 'addr-2', address: 'bcrt1qsecond', chain: 'bitcoin', network: 'regtest', accountId: 'acct-second', publicKey: '02bb', derivationPath: "m/84'/1'/1'/0/0" },
            ],
        },
        accounts: {
            list: async () => ACCOUNTS.slice(),
            get: async (id) => ACCOUNTS.find((a) => a.id === id) ?? null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        connectedSites: {
            list: async () => [...stored.values()],
            findBy: async (field, value) => [...stored.values()].filter((s) => s[field] === value),
            put: async (s) => { stored.set(s.id, s); return s; },
            delete: async (id) => { stored.delete(id); },
        },
    };
}

const okThrottle = { check: () => ({ allowed: true }) };

function buildHost(vault, approvals, sdkRegistry = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals, signThrottle: okThrottle });
    return host;
}

// The explorer shape addressBalances reads, for the cases that exercise the
// amountRaw scale: `/address/` carries the native confirmed decimal at the
// chain's 8-decimal scale, `/balances/` carries token rows with their issuance
// `decimals`. Only the SEND-with-amountRaw path reads it, so every other case
// in this file keeps the bare `{}` registry.
function scalingSdkRegistry({ confirmed = '2.5', tokens = [] } = {}) {
    return {
        get: () => ({
            getAddress: async () => ({ balances: { confirmed } }),
            getBalances: async () => ({ data: tokens }),
        }),
    };
}

// Records what the approval screen was handed, and answers with exactly what
// ConnectApproval submits today: the chains the user ticked, and
// `accounts: requestedAccounts`, which is always empty (no account selector).
function recordingApprovals({ chains = [CHAIN], accounts = [] } = {}) {
    const seen = [];
    return {
        _seen: seen,
        connect: async (payload) => {
            seen.push(payload);
            return { approved: true, chains, accounts, canSignMessage: false, canSignAction: {} };
        },
        signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    };
}

function connectedSite(permissions) {
    return {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'dApp',
        permissions: {
            chains: [CHAIN],
            accounts: [],
            canSignMessage: false,
            canSignAction: { SEND: 'ask' },
            ...permissions,
        },
    };
}

beforeEach(() => {
    sendToken.mockReset().mockImplementation(async () => ({ txid: 'tx' }));
});

describe('Connect never persists a wildcard account grant', () => {
    it('narrows an empty approved account list to the primary account', async () => {
        const vault = makeVault();
        const host = buildHost(vault, recordingApprovals({ accounts: [] }));

        const resp = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requestedChains: [CHAIN] },
        });

        expect(resp.ok).toBe(true);
        expect(resp.result.permissions.accounts).toEqual(['acct-primary']);
        const [site] = await vault.connectedSites.list();
        expect(site.permissions.accounts, 'stored grant is concrete, not a wildcard')
            .toEqual(['acct-primary']);
    });

    it('so the connected site can enumerate only the granted account', async () => {
        const vault = makeVault();
        const host = buildHost(vault, recordingApprovals({ accounts: [] }));
        await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requestedChains: [CHAIN] },
        });

        const accounts = await host.handle({
            type: 'bridge.getAccounts',
            request: { origin: ORIGIN },
        });
        expect(accounts.result.map((a) => a.id)).toEqual(['acct-primary']);

        const addresses = await host.handle({
            type: 'bridge.getAddresses',
            request: { origin: ORIGIN, chainId: CHAIN },
        });
        expect(addresses.result.map((a) => a.address), 'the other account stays hidden')
            .toEqual([FROM]);
    });

    it('leaves an explicit multi-account approval alone', async () => {
        const vault = makeVault();
        const approvals = recordingApprovals({ accounts: ['acct-primary', 'acct-second'] });
        const host = buildHost(vault, approvals);
        const resp = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requestedChains: [CHAIN] },
        });
        expect(resp.result.permissions.accounts).toEqual(['acct-primary', 'acct-second']);
    });
});

describe('Connect reads the option names ConnectOpts publishes', () => {
    it('forwards requestedChains to the approval screen for preselection', async () => {
        const approvals = recordingApprovals();
        const host = buildHost(makeVault(), approvals);
        await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requestedChains: [CHAIN] },
        });
        expect(approvals._seen[0].requestedChains).toEqual([CHAIN]);
    });

    it('still accepts the legacy `chains` name', async () => {
        const approvals = recordingApprovals();
        const host = buildHost(makeVault(), approvals);
        await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', chains: [CHAIN] },
        });
        expect(approvals._seen[0].requestedChains).toEqual([CHAIN]);
    });

    it('negotiates requiredBridgeVersion as a range instead of skipping it', async () => {
        const host = buildHost(makeVault(), recordingApprovals());
        const satisfied = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requiredBridgeVersion: '^0.1.0' },
        });
        expect(satisfied.ok, 'a range the wallet satisfies connects').toBe(true);

        const unsatisfied = await host.handle({
            type: 'bridge.connect',
            request: { origin: 'https://other.example', appName: 'dApp', requiredBridgeVersion: '^1.2.0' },
        });
        expect(unsatisfied.ok).toBe(false);
        expect(unsatisfied.error.code).toBe('BRIDGE_VERSION_MISMATCH');
        expect(unsatisfied.error.message).toMatch(/^bridge: BRIDGE_VERSION_MISMATCH/);
    });

    it('reports the wallet\'s own version, never the requested range', async () => {
        const host = buildHost(makeVault(), recordingApprovals());
        const resp = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requiredBridgeVersion: '^0.1.0' },
        });
        expect(resp.result.version).toBe('0.1.0');
        expect(resp.result.supportedVersions).toEqual(['0.1.0']);
    });
});

describe('signAction consumes the published SEND parameter shape', () => {
    it('maps fromAddress/toAddress/asset onto the flow contract', async () => {
        const vault = makeVault({ sites: [connectedSite()] });
        const host = buildHost(vault, recordingApprovals());

        const resp = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: {
                    fromAddress: FROM,
                    toAddress: TO,
                    asset: 'BTC',
                    // The decimal the flow signs. `amountRaw` is the published
                    // name and is SCALED onto it, not renamed: see the next case.
                    amount: '0.0001',
                    memo: 'example send',
                },
            },
        });

        expect(resp.ok, resp.error?.message).toBe(true);
        expect(sendToken).toHaveBeenCalledTimes(1);
        const opts = sendToken.mock.calls[0][0];
        // `from` is the vault's own address record, resolved here rather than
        // taken from the request: the flow needs a public key the dApp does
        // not have, and a caller-named source would sidestep the vault lookup.
        expect(opts.from).toMatchObject({ address: FROM, publicKey: '02aa' });
        expect(opts.to).toBe(TO);
        expect(opts.tick).toBe('BTC');
        expect(opts.amount).toBe('0.0001');
        expect(opts.memo).toBe('example send');
        // Trusted keys still win over anything the dApp sent.
        expect(opts.chainId).toBe(CHAIN);
        expect(opts.trackPendingTx).toBe(true);
    });

    // The unit gap, which is a conversion rather than a rename. amountRaw is an
    // integer in BASE units; the flow's `amount` is a decimal at human scale
    // that nativePayment.satsStringFromDecimal scales by 1e8. Renaming one onto
    // the other turned test-dapp's own `amountRaw: '10000'` (0.0001 BTC) into a
    // 10,000 BTC spend. The scale is the asset's divisibility, read from the
    // spending address's own balances, and the conversion runs BEFORE the
    // approval so the screen states the converted decimal rather than the raw
    // integer: a wrong scale is then wrong in front of the user, not behind
    // them. Unresolvable scales still refuse (see the two cases below).
    it('scales amountRaw by the asset divisibility rather than renaming it', async () => {
        const vault = makeVault({ sites: [connectedSite()] });
        const host = buildHost(vault, recordingApprovals(), scalingSdkRegistry());

        const resp = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: {
                    fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000',
                },
            },
        });

        expect(resp.ok, resp.error?.message).toBe(true);
        expect(sendToken).toHaveBeenCalledTimes(1);
        // 10,000 sats at the native 8-decimal scale, NOT 10000.
        expect(sendToken.mock.calls[0][0].amount).toBe('0.0001');
    });

    it('shows the converted decimal on the approval screen it signs from', async () => {
        const vault = makeVault({ sites: [connectedSite()] });
        const approvals = recordingApprovals();
        const seen = [];
        approvals.signAction = async (payload) => {
            seen.push(payload);
            return { approved: true, password: 'pw', walletId: 'wallet-1' };
        };
        const host = buildHost(vault, approvals, scalingSdkRegistry());

        await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: {
                    fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000',
                },
            },
        });

        // The approval screen describes protocol keys (decoder.describe's
        // decodeSend reads TICK / AMOUNT / DESTINATION), and it is handed the
        // same number the flow was.
        expect(seen).toHaveLength(1);
        expect(seen[0].payload.AMOUNT).toBe(sendToken.mock.calls[0][0].amount);
        expect(seen[0].payload.TICK).toBe('BTC');
        expect(seen[0].payload.DESTINATION).toBe(TO);
    });

    it('refuses an amountRaw whose scale it cannot read', async () => {
        const vault = makeVault({ sites: [connectedSite()] });
        // No row for the asset, so the divisibility is unknown; defaulting one
        // would be a silent multiplication of the spend.
        const host = buildHost(vault, recordingApprovals(), scalingSdkRegistry());

        const resp = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: {
                    fromAddress: FROM, toAddress: TO, asset: 'GHOST', amountRaw: '10000',
                },
            },
        });

        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/^bridge: INVALID_PARAMS/);
        expect(sendToken, 'nothing is signed on an amount the wallet cannot scale')
            .not.toHaveBeenCalled();
    });

    it('enforces the account scope against the published address name', async () => {
        const vault = makeVault({
            sites: [connectedSite({ accounts: ['acct-second'] })],
        });
        const host = buildHost(vault, recordingApprovals());

        const resp = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '1' },
            },
        });

        // Out of scope, and named as such: before the fix the gate read
        // `params.from`, saw undefined and reported MISSING_ADDRESS instead.
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/^bridge: ADDRESS_NOT_PERMITTED/);
        expect(sendToken).not.toHaveBeenCalled();
    });

    it('refuses a source address the wallet does not hold', async () => {
        const vault = makeVault({ sites: [connectedSite()] });
        const host = buildHost(vault, recordingApprovals());
        const resp = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: { fromAddress: 'bcrt1qnotours', toAddress: TO, asset: 'BTC', amountRaw: '1' },
            },
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/^bridge: ADDRESS_NOT_FOUND/);
        expect(sendToken).not.toHaveBeenCalled();
    });
});

describe('Bridge events carry the origin they were meant for', () => {
    function fakeTabs() {
        const sent = [];
        return {
            _sent: sent,
            sendMessage: (id, message, cb) => {
                sent.push({ id, message });
                if (typeof cb === 'function') cb();
            },
        };
    }

    // Target selection comes from the connected-tab registry, not from
    // `tab.url`: MV3 leaves Tab.url undefined for a manifest holding no "tabs"
    // or host permission, which is exactly why the URL filter delivered
    // nothing. A fake registry keeps this test about the origin stamp.
    function fakeConnectedTabs(map) {
        return { tabsForOrigin: async (origin) => (map[origin] ?? []) };
    }

    it('stamps the intended origin on every fanned-out event', async () => {
        const tabs = fakeTabs();
        const events = createBridgeEventBroadcaster({
            tabs,
            connectedTabs: fakeConnectedTabs({
                [ORIGIN]: [1],
                'https://other.example': [2],
            }),
        });
        await events.accountsChanged(ORIGIN, [{ id: 'acct-primary', name: 'Primary' }]);

        expect(tabs._sent).toHaveLength(1);
        expect(tabs._sent[0].id).toBe(1);
        expect(tabs._sent[0].message.origin, 'receiver can re-check after a navigation')
            .toBe(ORIGIN);
        expect(tabs._sent[0].message.event).toBe('accountsChanged');
    });

    it('stamps chainChanged and disconnect the same way', async () => {
        const tabs = fakeTabs();
        const events = createBridgeEventBroadcaster({
            tabs,
            connectedTabs: fakeConnectedTabs({ [ORIGIN]: [1] }),
        });
        await events.chainChanged(ORIGIN, CHAIN);
        await events.disconnect(ORIGIN, 'user-requested');
        expect(tabs._sent.map((s) => s.message.origin)).toEqual([ORIGIN, ORIGIN]);
    });
});
