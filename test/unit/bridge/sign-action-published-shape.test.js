// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: bridge.signAction consumes the shape bridge-spec PUBLISHES.
//
//`SendActionParams` (packages/bridge-spec/src/index.ts:219-225)
// declares fromAddress / toAddress / asset / amountRaw; the handler authorized
// `params.from` and spread the request straight into sendToken, whose contract
// is from / to / tick / amount with `from` a resolved address record. A
// compliant SEND therefore died on "sendToken: from is required" before
// signing.
//
// `amountRaw` is the half that is not a rename: it is an integer in BASE units
// while the flow signs a human-scale decimal, so `{ asset: 'BTC', amountRaw:
// '10000' }` (0.0001 BTC, the reference dApp's own example) renamed onto
// `amount` signs as 10,000 BTC. These drive the real registerBridgeHandlers
// through a real MessageHost and assert on the APPROVAL payload, which the
// handler now builds from the same values the flow call receives - so the test
// covers the conversion and the "what the user was shown is what gets signed"
// property together, without reaching a signature.

import { describe, it, expect } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://dapp.example';
const FROM = 'bcrt1qfrom';
const TO = 'bcrt1qto';

const descriptor = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    get: (id) => (id === descriptor.id ? descriptor : null),
    descriptorFor: (id) => (id === descriptor.id ? descriptor : null),
    supportedChains: () => [descriptor],
};

function fakeVault() {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            chains: [descriptor.id],
            accounts: [],
            canSignAction: {},
            canSignMessage: false,
        },
    };
    return {
        settings: { get: async () => ({ blockedOrigins: [] }) },
        connectedSites: {
            findBy: async (field, value) => [site].filter((s) => s[field] === value),
            put: async () => site,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }] },
        accounts: { list: async () => [], get: async () => ({ walletId: 'wallet-1' }) },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                accountId: 'acct-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: FROM,
                publicKey: '02aa',
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
    };
}

// The explorer shape addressBalances reads: `/address/` carries the native
// confirmed decimal (8-decimal scale), `/balances/` carries the token rows with
// their issuance `decimals`.
function fakeSdkRegistry({ confirmed = '1.5', tokens = [] } = {}) {
    return {
        get: () => ({
            getAddress: async () => ({ balances: { confirmed } }),
            getBalances: async () => ({ data: tokens }),
        }),
    };
}

function runSignAction({ params, sdkRegistry, action = 'SEND' }) {
    const calls = [];
    const approvals = {
        signAction: async (req) => { calls.push(req); return { approved: false }; },
    };
    const host = new MessageHost({ vault: fakeVault(), chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals });
    const resp = host.handle({
        type: 'bridge.signAction',
        request: { origin: ORIGIN, chainId: descriptor.id, action, params },
    });
    return resp.then((r) => ({ resp: r, calls }));
}

describe('bridge.signAction: the published SEND shape reaches the approval', () => {
    it('authorizes fromAddress, not the `from` no published shape carries', async () => {
        const { calls } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry: fakeSdkRegistry(),
        });
        // Reaching the prompt at all means the account-scope gate read a real
        // address; the pre-fix handler fed it `undefined`.
        expect(calls).toHaveLength(1);
        expect(calls[0].payload.from.address).toBe(FROM);
    });

    it('scales amountRaw by the asset divisibility instead of renaming it', async () => {
        const { calls } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry: fakeSdkRegistry(),
        });
        // 10,000 sats at the native 8-decimal scale. A rename would show
        // (and sign) 10000.
        expect(calls[0].payload.AMOUNT).toBe('0.0001');
        expect(calls[0].payload.TICK).toBe('BTC');
        expect(calls[0].payload.DESTINATION).toBe(TO);
    });

    it('uses the TOKEN row decimals, not the native scale', async () => {
        const { calls } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'JDOG', amountRaw: '12345' },
            sdkRegistry: fakeSdkRegistry({
                tokens: [{ tick: 'JDOG', quantity: '900000', decimals: 2 }],
            }),
        });
        expect(calls[0].payload.AMOUNT).toBe('123.45');
    });

    it('describes a zero-divisibility token as a whole number', async () => {
        const { calls } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'WHOLE', amountRaw: '42' },
            sdkRegistry: fakeSdkRegistry({
                tokens: [{ tick: 'WHOLE', quantity: '900', decimals: 0 }],
            }),
        });
        expect(calls[0].payload.AMOUNT).toBe('42');
    });

    it('refuses rather than defaulting a scale it cannot read', async () => {
        // No row for the asset: the divisibility is unknown, and a default
        // would be a silent multiplication of the spend.
        const { resp, calls } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'GHOST', amountRaw: '10000' },
            sdkRegistry: fakeSdkRegistry(),
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
        expect(calls, 'refused before the user was asked to approve').toHaveLength(0);
    });

    it('refuses a non-integer amountRaw', async () => {
        const { resp } = await runSignAction({
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '0.5' },
            sdkRegistry: fakeSdkRegistry(),
        });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
    });

    it('leaves the legacy decimal `amount` alone', async () => {
        // In-repo callers pass the flow vocabulary already; no balance read
        // should be needed, so the SDK registry throws if one is attempted.
        const exploding = { get: () => { throw new Error('no balance read expected'); } };
        const { calls } = await runSignAction({
            params: { from: FROM, to: TO, tick: 'BTC', amount: '0.25' },
            sdkRegistry: exploding,
        });
        expect(calls[0].payload.AMOUNT).toBe('0.25');
        expect(calls[0].payload.DESTINATION).toBe(TO);
    });

    it('keeps the dApp request verbatim alongside the described shape', async () => {
        const params = { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' };
        const { calls } = await runSignAction({ params, sdkRegistry: fakeSdkRegistry() });
        expect(calls[0].payload.requested).toEqual(params);
    });
});

describe('bridge.signAction: SWEEP describes what sweepToken defaults', () => {
    it('maps toAddress and states the category flags', async () => {
        const { calls } = await runSignAction({
            action: 'SWEEP',
            params: { fromAddress: FROM, toAddress: TO },
            sdkRegistry: fakeSdkRegistry(),
        });
        expect(calls[0].payload.DESTINATION).toBe(TO);
        // sweepToken.js:65-69 defaults balances/ownerships on, escrow off.
        expect(calls[0].payload.BALANCES).toBe('1');
        expect(calls[0].payload.OWNERSHIPS).toBe('1');
        expect(calls[0].payload.ORDERS).toBe('0');
        expect(calls[0].payload.SWAPS).toBe('0');
        expect(calls[0].payload.DISPENSERS).toBe('0');
    });
});
