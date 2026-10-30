// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dApp page is a surface an onlooker can watch. When the duress passphrase
// armed the signing freeze, every answer the bridge gives a page reads as an
// ordinary failure: no PANIC_MODE code, no PanicModeActiveError name, no
// "panic mode" sentence and no remaining time. A freeze the user armed in
// Settings keeps its published PANIC_MODE answer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');
const panic = await import('../../../packages/core/src/flows/panicMode.js');

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';

const DESCRIPTOR = {
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
};
const chainRegistry = {
    get: (id) => (id === CHAIN ? DESCRIPTOR : null),
    descriptorFor: (id) => (id === CHAIN ? DESCRIPTOR : null),
    supportedChains: () => [DESCRIPTOR],
    chainIdFor: () => CHAIN,
};

function makeVault() {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        appName: 'dApp',
        permissions: {
            chains: [CHAIN],
            accounts: ['acct-primary'],
            canSignMessage: true,
            canSignAction: { SEND: 'ask', SWEEP: 'ask' },
        },
    };
    return {
        settings: {
            get: async () => ({ developerMode: false, activeNetwork: 'regtest', fees: { [CHAIN]: {} }, blockedOrigins: [] }),
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
            list: async () => [{ id: 'acct-primary', name: 'Primary', walletId: 'wallet-1' }],
            get: async (id) => (id === 'acct-primary' ? { id, name: 'Primary', walletId: 'wallet-1' } : null),
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        connectedSites: {
            list: async () => [site],
            findBy: async (field, value) => [site].filter((s) => s[field] === value),
            put: async (s) => s,
            delete: async () => {},
        },
    };
}

const approve = async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' });
const approvals = {
    connect: approve,
    signMessage: approve,
    signAction: approve,
    signPsbt: approve,
    coSign: approve,
    signIn: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1', address: FROM }),
};

function buildHost() {
    const host = new MessageHost({ vault: makeVault(), chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals, signThrottle: { check: () => ({ allowed: true }) } });
    return host;
}

const SEND_PARAMS = { fromAddress: FROM, toAddress: 'bcrt1qto', asset: 'BTC', amount: '1' };

/** Everything a page can read about one failure, as one string. */
function pageView(value) {
    return JSON.stringify(value);
}

function expectNoFreezeCue(value) {
    const text = pageView(value);
    expect(text).not.toMatch(/PANIC/i);
    expect(text).not.toMatch(/frozen|freeze/i);
    expect(text).not.toMatch(/remainingMs/);
    expect(text).not.toMatch(/duress/i);
}

function armFreeze(armedBy) {
    panic.activatePanicMode({ armedBy });
    const refusal = () => {
        // The real core flows refuse here; the mocks reproduce that refusal.
        panic.assertSigningAllowed();
        throw new Error('unreachable');
    };
    flowMocks.signMessageFlow.mockImplementation(refusal);
    flowMocks.signPsbtFlow.mockImplementation(refusal);
    flowMocks.sendToken.mockImplementation(refusal);
    flowMocks.findCoSignerAccountByAddress.mockResolvedValue({
        id: 'cosigner-1', aggregateAddress: 'bcrt1pagg', name: 'Policy signer',
        chainId: CHAIN, daemonDerivationPath: "m/84'/1'/0'/0/0",
    });
    flowMocks.passiveCoSignForAccount.mockImplementation(async () => {
        try {
            panic.assertSigningAllowed();
        } catch (e) {
            return { approved: false, reason: 'PANIC_MODE', detail: { remainingMs: e.remainingMs ?? null } };
        }
        throw new Error('unreachable');
    });
}

const COSIGN_REQUEST = {
    origin: ORIGIN, chainId: CHAIN, aggregateAddress: 'bcrt1pagg',
    psbtHex: '70736274', agentPublicNonce: '02ff',
};

beforeEach(() => {
    for (const mock of Object.values(flowMocks)) mock.mockReset();
    panic.__resetPanicModePersistenceForTests();
    localStorage.clear();
});

afterEach(() => {
    panic.deactivatePanicMode();
    localStorage.clear();
});

describe('a duress-armed freeze answers a dApp as an ordinary failure', () => {
    it('signMessage, signAction and signPsbt carry no freeze cue', async () => {
        armFreeze(panic.PANIC_ARMED_DURESS);
        const host = buildHost();
        const message = await host.handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hello' },
        });
        const action = await host.handle({
            type: 'bridge.signAction',
            request: { origin: ORIGIN, chainId: CHAIN, action: 'SEND', params: SEND_PARAMS },
        });
        const psbt = await host.handle({
            type: 'bridge.signPsbt',
            request: { origin: ORIGIN, chainId: CHAIN, psbtHex: '70736274', signingPaths: [{ inputIndex: 0, address: FROM }] },
        });
        for (const response of [message, action, psbt]) {
            expect(response.ok).toBe(false);
            expect(response.error.code).toBe('INTERNAL_ERROR');
            expectNoFreezeCue(response);
        }
    });

    it('a parallel slot carries no freeze cue', async () => {
        armFreeze(panic.PANIC_ARMED_DURESS);
        const { result } = await buildHost().handle({
            type: 'bridge.parallel',
            request: { origin: ORIGIN, actions: [{ chainId: CHAIN, action: 'SEND', params: SEND_PARAMS }] },
        });
        expect(result[0].ok).toBe(false);
        expect(result[0].error).toBe('INTERNAL_ERROR');
        expectNoFreezeCue(result);
    });

    it('a coSign refusal carries no freeze reason or remaining time', async () => {
        armFreeze(panic.PANIC_ARMED_DURESS);
        const response = await buildHost().handle({ type: 'bridge.coSign', request: COSIGN_REQUEST });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INTERNAL_ERROR');
        expectNoFreezeCue(response);
    });
});

describe('a self-armed freeze keeps its published answer', () => {
    it('signMessage answers PANIC_MODE', async () => {
        armFreeze(panic.PANIC_ARMED_SELF);
        const response = await buildHost().handle({
            type: 'bridge.signMessage',
            request: { origin: ORIGIN, chainId: CHAIN, address: FROM, message: 'hello' },
        });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('PANIC_MODE');
    });

    it('coSign answers its PANIC_MODE refusal', async () => {
        armFreeze(panic.PANIC_ARMED_SELF);
        const { result } = await buildHost().handle({ type: 'bridge.coSign', request: COSIGN_REQUEST });
        expect(result).toMatchObject({ ok: true, approved: false, reason: 'PANIC_MODE' });
    });
});
