// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    createCoSignerAccount,
    validateCoSignerAccount,
} from '../../../packages/core/src/schemas/coSignerAccount.js';

const AGENT_KEY = `02${'a'.repeat(64)}`;
const DAEMON_KEY = `03${'b'.repeat(64)}`;

const baseInput = (overrides = {}) => ({
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    name: 'Agent',
    aggregateAddress: 'bc1paccount',
    agentPubkey: AGENT_KEY,
    daemonPubkey: DAEMON_KEY,
    daemonDerivationPath: "m/86'/0'/0'/0/0",
    publicKeyOrder: [AGENT_KEY, DAEMON_KEY],
    policy: { allowedActions: ['send'] },
    ...overrides,
});

describe('co-signer account creation edge branches', () => {
    it('rejects each missing required account field', () => {
        expect(() => createCoSignerAccount(null)).toThrow(/input is required/);
        expect(() => createCoSignerAccount(baseInput({ chainId: '' }))).toThrow(/chainId/);
        expect(() => createCoSignerAccount(baseInput({ agentPubkey: '' }))).toThrow(/agentPubkey/);
        expect(() => createCoSignerAccount(baseInput({ daemonPubkey: '' }))).toThrow(/daemonPubkey/);
        expect(() => createCoSignerAccount(baseInput({ daemonDerivationPath: '' }))).toThrow(/daemonDerivationPath/);
        expect(() => createCoSignerAccount(baseInput({ aggregateAddress: '' }))).toThrow(/aggregateAddress/);
        expect(() => createCoSignerAccount(baseInput({ publicKeyOrder: null }))).toThrow(/publicKeyOrder/);
        expect(() => createCoSignerAccount(baseInput({ publicKeyOrder: [AGENT_KEY] }))).toThrow(/publicKeyOrder/);
    });

    it('rejects missing policy actions and unsafe key material', () => {
        expect(() => createCoSignerAccount(baseInput({ policy: null }))).toThrow(/allowedActions/);
        expect(() => createCoSignerAccount(baseInput({ policy: { allowedActions: null } }))).toThrow(/allowedActions/);
        expect(() => createCoSignerAccount(baseInput({ policy: { allowedActions: [] } }))).toThrow(/allowedActions/);
        expect(() => createCoSignerAccount(baseInput({ tweak: 'ab' }))).toThrow(/raw taproot tweak/);
        expect(() => createCoSignerAccount(baseInput({ recoveryPublicKey: 'not-hex' }))).toThrow(/recoveryPublicKey/);
    });

    it('applies optional defaults and normalizes optional values', () => {
        const account = createCoSignerAccount(baseInput({
            name: '',
            recoveryPublicKey: `02${'C'.repeat(64)}`,
            allowedOutputs: null,
            enabled: false,
            policy: {
                allowedActions: ['send'],
                allowedDestinations: [123],
                maxPerAction: { SEND: { XCP: '1' } },
                maxPerWindow: { hours: 1 },
                confirmAbove: { perTick: { XCP: '2' } },
            },
        }));

        expect(account).toMatchObject({
            name: 'Agent account',
            recoveryPublicKey: `02${'c'.repeat(64)}`,
            allowedOutputs: [],
            enabled: false,
        });
        expect(account.policy.allowedDestinations).toEqual(['123']);
    });
});

describe('co-signer account validation edge branches', () => {
    const validAccount = () => createCoSignerAccount(baseInput());

    it('rejects non-object records', () => {
        expect(validateCoSignerAccount(null).ok).toBe(false);
    });

    it('rejects malformed policies at each nested branch', () => {
        const policies = [
            null,
            { allowedActions: null },
            { allowedActions: [] },
            { allowedActions: [''] },
            { allowedActions: ['SEND'], allowedDestinations: 7 },
            { allowedActions: ['SEND'], allowedDestinations: ['ok', 7] },
            { allowedActions: ['SEND'], maxPerAction: 7 },
            { allowedActions: ['SEND'], maxPerWindow: 7 },
            { allowedActions: ['SEND'], maxPerWindow: { hours: 0 } },
            { allowedActions: ['SEND'], confirmAbove: 7 },
        ];

        for (const policy of policies) {
            expect(validateCoSignerAccount({ ...validAccount(), policy }).ok).toBe(false);
        }
    });

    it('accepts undefined and structured optional policy fields', () => {
        const account = validAccount();
        const policy = {
            allowedActions: ['SEND'],
            allowedDestinations: undefined,
            maxPerAction: undefined,
            maxPerWindow: { hours: 2 },
            confirmAbove: undefined,
        };
        expect(validateCoSignerAccount({ ...account, policy }).ok).toBe(true);
        expect(validateCoSignerAccount({
            ...account,
            policy: {
                allowedActions: ['SEND'],
                allowedDestinations: ['destination'],
                maxPerAction: {},
                maxPerWindow: null,
                confirmAbove: {},
            },
        }).ok).toBe(true);
    });

    it('rejects malformed window states and entries', () => {
        const windows = [
            7,
            { version: '1', entries: [] },
            { version: 1, entries: null },
            { version: 1, entries: [null] },
            { version: 1, entries: [{ t: 'soon' }] },
        ];

        for (const window of windows) {
            expect(validateCoSignerAccount({ ...validAccount(), window }).ok).toBe(false);
        }
        expect(validateCoSignerAccount({ ...validAccount(), window: undefined }).ok).toBe(true);
    });

    it('covers every allowed output shape', () => {
        const account = validAccount();
        const invalidOutputs = [
            null,
            {},
            { address: '', script: '' },
            { address: 'destination', maxValue: -1 },
            { script: '51', maxValue: '1' },
        ];

        for (const output of invalidOutputs) {
            expect(validateCoSignerAccount({ ...account, allowedOutputs: [output] }).ok).toBe(false);
        }
        expect(validateCoSignerAccount({
            ...account,
            allowedOutputs: [
                { address: 'destination' },
                { script: '51', maxValue: null },
                { script: '52', maxValue: 0 },
            ],
        }).ok).toBe(true);
    });
});
