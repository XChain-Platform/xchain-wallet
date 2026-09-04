// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bridge answers in the envelope bridge-spec publishes.
//
// The handlers used to forward whatever the core flow returned. That made the
// bridge's real contract "whatever core returns today" while its PUBLISHED
// contract (packages/bridge-spec/src/index.ts) said something else, and the
// gap was invisible to a source scan because both sides were internally
// consistent. Three separate breaks:
//
//   - No `ok` flag on any result, so `if (!conn.ok)` - the first branch in
//     bridge-spec's own worked example - was `if (!undefined)`, i.e. always
//     taken, on every SUCCESSFUL connect.
//   - connect returned account-id STRINGS where ConnectSuccess declares
//     `Account[]`, and omitted `permissions` entirely.
//   - Failures carried twelve codes the published BridgeErrorCode union does
//     not contain, and the transport dropped `code` anyway, so a dApp could
//     only regex the human-readable message.
//
// The five read methods are the reason this could not be fixed by wrapping the
// page shim: bridge-spec declares them as bare arrays, so a blanket envelope
// would have broken the half that was correct.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import handlersSource from '../../../packages/extension/src/bridge/handlers.js?raw';
import specSource from '../../../packages/bridge-spec/src/index.ts?raw';
import providerSource from '../../../packages/extension/src/inject/xchainProvider.js?raw';

const flowMocks = vi.hoisted(() => ({
    sendToken: vi.fn(),
    signMessageFlow: vi.fn(),
    signPsbtFlow: vi.fn(),
    addressBalances: vi.fn(),
    passiveCoSignForAccount: vi.fn(),
    findCoSignerAccountByAddress: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, ...flowMocks } };
});

const { MessageHost, serializeError, hydrateEnvelopeError } =
    await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } =
    await import('../../../packages/extension/src/bridge/handlers.js');
const { BRIDGE_ERROR_CODES, isBridgeErrorCode } =
    await import('@xchain-wallet/bridge-spec');
const { INTERNAL_TO_BRIDGE_ERROR_CODE, toBridgeErrorCode, bridgeErrorCodeFor } =
    await import('../../../packages/extension/src/bridge/errorCodes.js');

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';

const DESCRIPTORS = {
    [CHAIN]: {
        id: CHAIN,
        coin: 'bitcoin',
        networkKind: 'regtest',
        displayName: 'Bitcoin Regtest',
        color: '#f7931a',
        icon: '',
        addressTypes: ['p2wpkh'],
        defaultAddressType: 'p2wpkh',
        supportedActions: ['SEND'],
        uriScheme: 'bitcoin',
    },
};
const chainRegistry = {
    get: (id) => DESCRIPTORS[id] ?? null,
    descriptorFor: (id) => DESCRIPTORS[id] ?? null,
    supportedChains: () => Object.values(DESCRIPTORS),
    chainIdFor: () => CHAIN,
};

const ACCOUNTS = [
    { id: 'acct-primary', name: 'Primary', walletId: 'wallet-1' },
    { id: 'acct-second', name: 'Second', walletId: 'wallet-1' },
];

function makeVault({ site = null } = {}) {
    const sites = new Map(site ? [[site.id, site]] : []);
    return {
        _sites: sites,
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
                {
                    id: 'addr-1',
                    address: FROM,
                    chain: 'bitcoin',
                    network: 'regtest',
                    accountId: 'acct-primary',
                    publicKey: '02aa',
                    derivationPath: "m/84'/1'/0'/0/0",
                    addressType: 'p2wpkh',
                    label: 'Address #0',
                },
            ],
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

function connectedSite(permissions = {}) {
    return {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'dApp',
        permissions: {
            chains: [CHAIN],
            accounts: ['acct-primary'],
            canSignMessage: true,
            canSignAction: { SEND: 'ask', SWEEP: 'ask' },
            ...permissions,
        },
    };
}

const approvals = {
    connect: async () => ({
        approved: true, chains: [CHAIN], accounts: [], canSignMessage: false, canSignAction: {},
    }),
    signMessage: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    signPsbt: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    coSign: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    signIn: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1', address: FROM }),
};

const okThrottle = { check: () => ({ allowed: true }) };

function buildHost(vault, { signThrottle = okThrottle, sdkRegistry = {} } = {}) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals, signThrottle });
    return host;
}

beforeEach(() => {
    for (const mock of Object.values(flowMocks)) mock.mockReset();
    flowMocks.sendToken.mockResolvedValue({ txid: 'tx-1', actionString: 'SEND|…', encoding: 'opreturn' });
    flowMocks.signMessageFlow.mockResolvedValue({ signature: 'sig-1' });
    flowMocks.signPsbtFlow.mockResolvedValue({ signedPsbtHex: 'ab', txHex: 'cd', txid: 'tx-2' });
});

// ---------------------------------------------------------------------------

describe('the published BridgeErrorCode union has a runtime twin', () => {
    it('BRIDGE_ERROR_CODES lists exactly the codes index.ts declares', () => {
        const union = specSource
            .split('export type BridgeErrorCode =')[1]
            .split(';')[0];
        const declared = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
        expect(declared.length).toBeGreaterThan(0);
        expect([...BRIDGE_ERROR_CODES].sort()).toEqual(declared.sort());
    });
});

describe('every code the handlers emit is translated to a published one', () => {
    it('maps all twelve internal codes, and nothing is left unmapped', () => {
        const emitted = new Set(
            [...handlersSource.matchAll(/bridgeError\(\s*'([A-Z_]+)'/g)].map((m) => m[1]),
        );
        expect(emitted.size).toBeGreaterThan(10);

        const unmapped = [...emitted].filter((code) => toBridgeErrorCode(code) === null);
        expect(unmapped, 'every emitted code resolves to a published code').toEqual([]);

        // The map covers exactly the emitted codes that are NOT already
        // published: a stale entry is as much a defect as a missing one.
        const nonSpec = [...emitted].filter((code) => !isBridgeErrorCode(code));
        expect(nonSpec.sort()).toEqual(Object.keys(INTERNAL_TO_BRIDGE_ERROR_CODE).sort());
        for (const mapped of Object.values(INTERNAL_TO_BRIDGE_ERROR_CODE)) {
            expect(isBridgeErrorCode(mapped)).toBe(true);
        }
    });

    it('classifies thrown error CLASSES that carry no code of their own', () => {
        expect(bridgeErrorCodeFor(Object.assign(new Error('x'), { name: 'PanicModeActiveError' })))
            .toBe('PANIC_MODE');
        expect(bridgeErrorCodeFor(Object.assign(new Error('x'), { name: 'VaultLockedError' })))
            .toBe('WALLET_LOCKED');
        expect(bridgeErrorCodeFor(Object.assign(new Error('x'), { name: 'BroadcastFailedError' })))
            .toBe('BROADCAST_FAILED');
    });

    it('never leaks an unrecognized code to the page', () => {
        expect(bridgeErrorCodeFor(Object.assign(new Error('x'), { code: 'SOMETHING_NEW' })))
            .toBe('INTERNAL_ERROR');
        expect(bridgeErrorCodeFor(new Error('plain'))).toBe('INTERNAL_ERROR');
    });
});

describe('the transport carries the structured error fields', () => {
    it('serializeError keeps code and the THROTTLED hints', () => {
        const err = Object.assign(new Error('slow down'), {
            name: 'BridgeError', code: 'THROTTLED', retryAfterMs: 1500, burst: 5, windowMs: 60000,
        });
        expect(serializeError(err)).toEqual({
            ok: false,
            error: {
                name: 'BridgeError',
                message: 'slow down',
                code: 'THROTTLED',
                retryAfterMs: 1500,
                burst: 5,
                windowMs: 60000,
            },
        });
    });

    it('hydrateEnvelopeError puts them back on the rebuilt Error', () => {
        const { error } = serializeError(Object.assign(new Error('slow down'), {
            name: 'BridgeError', code: 'THROTTLED', retryAfterMs: 1500, burst: 5, windowMs: 60000,
        }));
        const rebuilt = hydrateEnvelopeError(error);
        expect(rebuilt.name).toBe('BridgeError');
        expect(rebuilt.code).toBe('THROTTLED');
        expect(rebuilt.retryAfterMs).toBe(1500);
        expect(rebuilt.burst).toBe(5);
        expect(rebuilt.windowMs).toBe(60000);
    });

    it('a throttled bridge call reaches the wire with its retry window intact', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }), {
            signThrottle: {
                check: () => ({ allowed: false, retryAfterMs: 2000, burst: 3, windowMs: 60000 }),
            },
        });
        const resp = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hi' },
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('THROTTLED');
        expect(resp.error.retryAfterMs).toBe(2000);
        expect(resp.error.burst).toBe(3);
        expect(resp.error.windowMs).toBe(60000);
    });

    it('translates an internal refusal to its published code, keeping the detail in the message', async () => {
        const host = buildHost(makeVault({ site: connectedSite({ chains: [CHAIN] }) }));
        const resp = await host.handle({
            type: 'bridge.getAddresses',
            request: { origin: ORIGIN, chainId: 'litecoin-regtest' },
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('CHAIN_NOT_SUPPORTED');
        expect(resp.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
    });

    it('reports a rejected approval as USER_REJECTED, not as an error class name', async () => {
        const host = new MessageHost({
            vault: makeVault({ site: connectedSite() }), chainRegistry, sdkRegistry: {},
        });
        registerBridgeHandlers(host, {
            approvals: { ...approvals, signMessage: async () => ({ approved: false }) },
            signThrottle: okThrottle,
        });
        const resp = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hi' },
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('USER_REJECTED');
    });
});

describe('connect answers a ConnectSuccess', () => {
    it('carries ok, Account records, the granted chains, and the permissions', async () => {
        const host = buildHost(makeVault());
        const { result } = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp', requestedChains: [CHAIN] },
        });

        expect(result.ok).toBe(true);
        expect(typeof result.version).toBe('string');
        // Account RECORDS, not id strings.
        expect(result.accounts).toEqual([{ id: 'acct-primary', name: 'Primary' }]);
        expect(result.chains).toEqual([CHAIN]);
        expect(result.permissions).toEqual({
            chains: [CHAIN],
            accounts: ['acct-primary'],
            canSignMessage: false,
            canSignAction: {},
        });
    });

    it('answers the same shape when it re-uses an existing grant', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.connect',
            request: { origin: ORIGIN, appName: 'dApp' },
        });
        expect(result.ok).toBe(true);
        expect(result.accounts).toEqual([{ id: 'acct-primary', name: 'Primary' }]);
        expect(result.permissions.canSignMessage).toBe(true);
    });
});

describe('the read methods stay BARE ARRAYS', () => {
    it('getAccounts / getAddresses / getSupportedChains / getActiveChains are arrays with no ok flag', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        for (const [type, request] of [
            ['bridge.getAccounts', { origin: ORIGIN }],
            ['bridge.getAddresses', { origin: ORIGIN, chainId: CHAIN }],
            ['bridge.getSupportedChains', { origin: ORIGIN }],
            ['bridge.getActiveChains', { origin: ORIGIN }],
        ]) {
            const resp = await host.handle({ type, request });
            expect(resp.ok, type).toBe(true);
            expect(Array.isArray(resp.result), `${type} returns an array`).toBe(true);
            expect(resp.result.ok, `${type} has no envelope flag`).toBeUndefined();
        }
    });

    it('getBalances answers Balance[], not the wallet-internal { native, tokens }', async () => {
        flowMocks.addressBalances.mockResolvedValue({
            native: { tick: 'BTC', quantity: '150000000', divisibility: 8 },
            tokens: [{ tick: 'PEPECREATURE', quantity: '99', divisibility: 0 }],
        });
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.getBalances',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM },
        });
        expect(result).toEqual([
            {
                asset: 'BTC',
                assetType: 'native',
                divisibility: 8,
                confirmedRaw: '150000000',
                unconfirmedRaw: '0',
                confirmed: '1.5',
                unconfirmed: '0',
            },
            {
                asset: 'PEPECREATURE',
                assetType: 'token',
                divisibility: 0,
                confirmedRaw: '99',
                unconfirmedRaw: '0',
                confirmed: '99',
                unconfirmed: '0',
            },
        ]);
    });

    it('omits a native row the explorer could not report rather than inventing a zero', async () => {
        flowMocks.addressBalances.mockResolvedValue({ native: null, tokens: [] });
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.getBalances',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM },
        });
        expect(result).toEqual([]);
    });
});

describe('the signing methods answer their published success shapes', () => {
    it('signMessage returns SignMessageSuccess with the exact bytes signed', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hello' },
        });
        expect(result).toEqual({
            ok: true, address: FROM, signature: 'sig-1', signedMessage: 'hello',
        });
    });

    it('signAction returns SignActionSuccess and omits an actionIndex it cannot know', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.signAction',
            request: {
                origin: ORIGIN,
                chainId: CHAIN,
                action: 'SEND',
                params: { fromAddress: FROM, toAddress: 'bcrt1qto', asset: 'BTC', amount: '1' },
            },
        });
        // The indexer assigns the action index after a block carries the tx;
        // this resolves at broadcast, so there is nothing honest to report.
        expect(result).toEqual({ ok: true, txid: 'tx-1', chainId: CHAIN });
        // None of core's internal submit fields leak through.
        expect(result.actionString).toBeUndefined();
        expect(result.encoding).toBeUndefined();
    });

    it('signAction refuses an unsupported kind with an UnsupportedActionResult', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.signAction',
            request: { origin: ORIGIN, chainId: CHAIN, action: 'ISSUE', params: {} },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('UNSUPPORTED_ACTION');
        expect(result.supportedActions).toEqual(['SEND', 'SWEEP']);
    });

    it('signPsbt returns SignPsbtSuccess', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.signPsbt',
            request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [{ inputIndex: 0, address: FROM }] },
        });
        expect(result).toEqual({ ok: true, signedPsbtHex: 'ab', txHex: 'cd', txid: 'tx-2' });
    });

    // bridge-spec publishes PsbtSigningPath as { inputIndex, address? |
    // derivationPath? }; the Signer contract wants { inputIndex, path? |
    // addressId? }. The handler owns the translation, and only against
    // addresses/paths the vault holds.
    describe('signPsbt normalizes spec-shaped signingPaths onto the Signer contract', () => {
        it('maps an owned address to its derivation path', async () => {
            const host = buildHost(makeVault({ site: connectedSite() }));
            await host.handle({
                type: 'bridge.signPsbt',
                request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [{ inputIndex: 0, address: FROM }] },
            });
            expect(flowMocks.signPsbtFlow.mock.calls[0][0].signingPaths).toEqual([
                { inputIndex: 0, path: "m/84'/1'/0'/0/0", addressId: undefined },
            ]);
        });

        it('maps an owned derivationPath to the same entry, and keeps sighashType', async () => {
            const host = buildHost(makeVault({ site: connectedSite() }));
            await host.handle({
                type: 'bridge.signPsbt',
                request: {
                    origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274',
                    signingPaths: [{ inputIndex: 1, derivationPath: "m/84'/1'/0'/0/0", sighashType: 1 }],
                },
            });
            expect(flowMocks.signPsbtFlow.mock.calls[0][0].signingPaths).toEqual([
                { inputIndex: 1, path: "m/84'/1'/0'/0/0", addressId: undefined, sighashType: 1 },
            ]);
        });

        it('refuses an address or a derivationPath the wallet does not own', async () => {
            const host = buildHost(makeVault({ site: connectedSite() }));
            for (const entry of [{ inputIndex: 0, address: 'bcrt1qsomeoneelse' }, { inputIndex: 0, derivationPath: "m/84'/1'/0'/0/7" }]) {
                const resp = await host.handle({
                    type: 'bridge.signPsbt',
                    request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [entry] },
                });
                expect(resp.ok).toBe(false);
                // The internal ADDRESS_NOT_FOUND rides the wire as the published
                // ADDRESS_NOT_AUTHORIZED (errorCodes.js), like sign-in's refusal.
                expect(resp.error.code).toBe('ADDRESS_NOT_AUTHORIZED');
            }
            expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
        });

        // Wallet ownership is weaker than the connect grant: signPsbt cannot
        // check only the former, so a site granted acct-primary could name any
        // vault address on the chain and get it signed behind the prompt.
        it('refuses an owned address whose account is outside the site grant', async () => {
            const host = buildHost(makeVault({ site: connectedSite({ accounts: ['acct-second'] }) }));
            for (const entry of [{ inputIndex: 0, address: FROM }, { inputIndex: 0, derivationPath: "m/84'/1'/0'/0/0" }]) {
                const resp = await host.handle({
                    type: 'bridge.signPsbt',
                    request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [entry] },
                });
                expect(resp.ok).toBe(false);
                // ADDRESS_NOT_PERMITTED rides the wire as ADDRESS_NOT_AUTHORIZED,
                // the same published code getBalances gives an out-of-scope address.
                expect(resp.error.code).toBe('ADDRESS_NOT_AUTHORIZED');
            }
            expect(flowMocks.signPsbtFlow).not.toHaveBeenCalled();
        });

        it('keeps the §43.3 empty-accounts wildcard signing', async () => {
            const host = buildHost(makeVault({ site: connectedSite({ accounts: [] }) }));
            const { result } = await host.handle({
                type: 'bridge.signPsbt',
                request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [{ inputIndex: 0, address: FROM }] },
            });
            expect(result.ok).toBe(true);
            expect(flowMocks.signPsbtFlow).toHaveBeenCalledTimes(1);
        });

        it('rejects a malformed entry before prompting the user', async () => {
            const host = buildHost(makeVault({ site: connectedSite() }));
            for (const bad of [[], [{ inputIndex: 0 }], [{ inputIndex: 0, address: FROM, derivationPath: 'm/0' }], [{ inputIndex: -1, address: FROM }]]) {
                const resp = await host.handle({
                    type: 'bridge.signPsbt',
                    request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: bad },
                });
                expect(resp.ok).toBe(false);
                expect(resp.error.code).toBe('INVALID_PARAMS');
            }
        });
    });

    it('signIn returns SignInSuccess', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.signIn',
            request: { origin: ORIGIN, chainId: CHAIN, appId: 'example.com' },
        });
        expect(result.ok).toBe(true);
        expect(result.address).toBe(FROM);
        expect(result.chainId).toBe(CHAIN);
        expect(result.signature).toBe('sig-1');
        expect(typeof result.challenge).toBe('string');
        expect(result.challengeParts.origin).toBe(ORIGIN);
    });

    it('coSign reports a policy refusal as ok:true / approved:false, not as an error', async () => {
        flowMocks.findCoSignerAccountByAddress.mockResolvedValue({
            id: 'cosigner-1', aggregateAddress: 'bcrt1pagg', name: 'Policy signer',
        });
        flowMocks.passiveCoSignForAccount.mockResolvedValue({
            approved: false, reason: 'ACCOUNT_DISABLED', detail: { accountId: 'cosigner-1' },
        });
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.coSign',
            request: {
                origin: ORIGIN, chainId: CHAIN, aggregateAddress: 'bcrt1pagg',
                psbtHex: '70736274', agentPublicNonce: '02ff',
            },
        });
        expect(result.ok).toBe(true);
        expect(result.approved).toBe(false);
        expect(result.reason).toBe('ACCOUNT_DISABLED');
    });
});

describe('parallel entries are SignActionResults', () => {
    it('each slot carries ok plus a published error code', async () => {
        const host = buildHost(makeVault({ site: connectedSite() }));
        const { result } = await host.handle({
            type: 'bridge.parallel',
            request: {
                origin: ORIGIN,
                actions: [
                    { chainId: CHAIN, action: 'SEND', params: { fromAddress: FROM, toAddress: 'bcrt1qto', asset: 'BTC', amount: '1' } },
                    { chainId: CHAIN, action: 'ISSUE', params: {} },
                    { chainId: 'litecoin-regtest', action: 'SEND', params: { fromAddress: FROM } },
                ],
            },
        });
        expect(result[0]).toEqual({ ok: true, txid: 'tx-1', chainId: CHAIN });
        expect(result[1].ok).toBe(false);
        expect(result[1].error).toBe('UNSUPPORTED_ACTION');
        expect(result[2].ok).toBe(false);
        expect(isBridgeErrorCode(result[2].error)).toBe(true);
        for (const entry of result) {
            if (entry.ok === false) expect(isBridgeErrorCode(entry.error)).toBe(true);
        }
    });
});

describe('the page shim splits result-union methods from bare-array reads', () => {
    it('imports nothing, because a classic-script injection cannot load a chunk', () => {
        // A static import here bundles into a real `import` of a shared chunk.
        // The content script injects this file with a plain `<script src>` tag,
        // and the chunk is not in web_accessible_resources, so the provider
        // would never install and `window.xchain` would never appear.
        expect(providerSource).not.toMatch(/^\s*import\s/m);
    });

    it('keeps its local BRIDGE_ERROR_CODES copy identical to the published list', () => {
        const inline = providerSource
            .split('const BRIDGE_ERROR_CODES = [')[1]
            .split('];')[0];
        const codes = [...inline.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
        expect(codes).toEqual([...BRIDGE_ERROR_CODES]);
    });

    it('resolves a refusal for every method bridge-spec gives a result union', () => {
        for (const method of ['connect', 'signMessage', 'signAction', 'signPsbt', 'coSign', 'signIn']) {
            expect(
                new RegExp(`${method}\\([^)]*\\)\\s*\\{\\s*return sendResult\\(`).test(providerSource),
                `${method} resolves a BridgeErrorResult instead of rejecting`,
            ).toBe(true);
        }
    });

    it('leaves the five read methods and disconnect rejecting, as their bare-array types require', () => {
        for (const method of [
            'disconnect', 'getAccounts', 'getAddresses', 'getBalances',
            'getSupportedChains', 'getActiveChains',
        ]) {
            expect(
                new RegExp(`${method}\\([^)]*\\)\\s*\\{\\s*return send\\(`).test(providerSource),
                `${method} keeps rejecting`,
            ).toBe(true);
        }
    });
});
