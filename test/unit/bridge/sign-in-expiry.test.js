// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The sign-in handler takes its expiry window from the page. The published
// spec says a wallet refuses a challenge that is already expired, so a
// non-positive or non-numeric window must be refused before the user is asked
// for a password, and every challenge the wallet does sign must parse.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const flowMocks = vi.hoisted(() => ({
    signSignInChallengeFlow: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, ...flowMocks } };
});

const { MessageHost } =
    await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } =
    await import('../../../packages/extension/src/bridge/handlers.js');
const { SIGN_IN_DEFAULT_EXPIRY_MS, parseSignInChallenge } =
    await import('@xchain-wallet/bridge-spec');

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qfromaddress';
const HOUR_MS = 60 * 60 * 1000;

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
    const accounts = [{ id: 'acct-primary', name: 'Primary', walletId: 'wallet-1' }];
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
            list: async () => accounts.slice(),
            get: async (id) => accounts.find((a) => a.id === id) ?? null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        connectedSites: {
            list: async () => [site],
            findBy: async (field, value) => (site[field] === value ? [site] : []),
            put: async (s) => s,
            delete: async () => {},
        },
    };
}

const approve = () => vi.fn(async () => ({
    approved: true, password: 'pw', walletId: 'wallet-1', address: FROM, chainId: CHAIN,
}));

function signInHost(signIn) {
    const host = new MessageHost({ vault: makeVault(), chainRegistry, sdkRegistry: {} });
    const approvals = {
        connect: async () => ({ approved: true }),
        signMessage: async () => ({ approved: true }),
        signAction: async () => ({ approved: true }),
        signPsbt: async () => ({ approved: true }),
        coSign: async () => ({ approved: true }),
        signIn,
    };
    registerBridgeHandlers(host, { approvals, signThrottle: { check: () => ({ allowed: true }) } });
    return host;
}

const call = (host, request) => host.handle({
    type: 'bridge.signIn', request: { origin: ORIGIN, appId: 'example.com', ...request },
});

beforeEach(() => {
    flowMocks.signSignInChallengeFlow.mockReset();
    flowMocks.signSignInChallengeFlow.mockResolvedValue({ signature: 'sig-1' });
});

describe('bridge.signIn refuses an expiry window that cannot yield a valid challenge', () => {
    it.each([
        ['zero', 0],
        ['negative', -1],
        ['non-numeric string', 'abc'],
        ['numeric string', '60000'],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['object', {}],
    ])('%s expiresInMs is refused before the user is prompted', async (_label, expiresInMs) => {
        const signIn = approve();
        const host = signInHost(signIn);
        const resp = await call(host, { expiresInMs });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('INVALID_PARAMS');
        expect(signIn).not.toHaveBeenCalled();
        expect(flowMocks.signSignInChallengeFlow).not.toHaveBeenCalled();
    });

    it('a window that rounds to an expiry equal to now is refused as expired, after the prompt', async () => {
        const signIn = approve();
        const host = signInHost(signIn);
        const resp = await call(host, { expiresInMs: 1e-9 });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('CHALLENGE_EXPIRED');
        expect(flowMocks.signSignInChallengeFlow).not.toHaveBeenCalled();
    });
});

describe('bridge.signIn refuses an invalid appId before prompting', () => {
    it.each([
        ['absent', undefined],
        ['null', null],
        ['empty', ''],
        ['number', 5],
        ['boolean', true],
        ['object', {}],
        ['array', []],
    ])('%s appId is refused', async (_label, appId) => {
        const signIn = approve();
        const host = signInHost(signIn);
        const resp = await call(host, { appId });
        expect(resp.ok).toBe(false);
        expect(resp.error.code).toBe('INVALID_PARAMS');
        expect(signIn).not.toHaveBeenCalled();
        expect(flowMocks.signSignInChallengeFlow).not.toHaveBeenCalled();
    });
});

describe('bridge.signIn signs only challenges the published parser accepts', () => {
    it('an absent window signs with the published default', async () => {
        const host = signInHost(approve());
        const { result } = await call(host, {});
        expect(result.ok).toBe(true);
        const { challengeParts: parts } = result;
        expect(parts.expiresAt - parts.timestamp).toBe(SIGN_IN_DEFAULT_EXPIRY_MS);
        expect(parseSignInChallenge(result.challenge)).toEqual(parts);
    });

    it('a null window is treated as absent', async () => {
        const host = signInHost(approve());
        const { result } = await call(host, { expiresInMs: null });
        expect(result.challengeParts.expiresAt - result.challengeParts.timestamp)
            .toBe(SIGN_IN_DEFAULT_EXPIRY_MS);
    });

    it('a positive window is honoured and a window past one hour is capped', async () => {
        const host = signInHost(approve());
        const short = (await call(host, { expiresInMs: 30_000 })).result;
        expect(short.challengeParts.expiresAt - short.challengeParts.timestamp).toBe(30_000);
        expect(parseSignInChallenge(short.challenge)).not.toBeNull();

        const long = (await call(host, { expiresInMs: 10 * HOUR_MS })).result;
        expect(long.challengeParts.expiresAt - long.challengeParts.timestamp).toBe(HOUR_MS);
        expect(parseSignInChallenge(long.challenge)).not.toBeNull();
    });

    it('a page-supplied nonce is kept and a missing one is generated', async () => {
        const host = signInHost(approve());
        const given = (await call(host, { nonce: 'page-nonce' })).result;
        expect(given.challengeParts.nonce).toBe('page-nonce');
        const made = (await call(host, {})).result;
        expect(made.challengeParts.nonce).toMatch(/^[0-9a-f]{32}$/);
    });
});
