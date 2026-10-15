// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    addressMigrations,
    pendingTxMigrations,
    settingsMigrations,
} from '../../../packages/core/src/schemas/migrations.js';

describe('schema migration edge branches', () => {
    it('classifies address roles for change, dispenser, and missing paths', () => {
        expect(addressMigrations[2]({
            schemaVersion: 2,
            derivationPath: "m/84'/0'/0'/1/0",
        }).role).toBe('change');
        expect(addressMigrations[2]({
            schemaVersion: 2,
            derivationPath: "m/84'/0'/0'/2/0",
        }).role).toBe('dispenser');
        expect(addressMigrations[2]({
            schemaVersion: 2,
            derivationPath: null,
        }).role).toBe('receive');
    });

    it('preserves non-string address labels', () => {
        expect(addressMigrations[3]({
            schemaVersion: 3,
            chain: 'bitcoin',
            label: null,
        }).label).toBeNull();
    });

    it('covers present and absent settings defaults', () => {
        const v2 = settingsMigrations[1]({
            schemaVersion: 1,
            privacy: {},
            grace: { testSendThresholdSats: 25 },
        });
        expect(v2.grace).toEqual({ undoSendSeconds: 5, testSendThresholdSats: 25 });

        const emptyV3 = settingsMigrations[2]({ schemaVersion: 2 });
        expect(emptyV3.ads.perChain).toEqual({});
        expect(emptyV3.fees).toEqual({});
    });

    it('distinguishes seeded, custom, and absent per-chain settings', () => {
        const migrated = settingsMigrations[2]({
            schemaVersion: 2,
            ads: {
                perChain: {
                    seeded: { perTxAmountSats: 1, triggerAmountSats: 1000 },
                    custom: { perTxAmountSats: 2, triggerAmountSats: 2000 },
                    absent: undefined,
                },
            },
            fees: {
                bitcoin: { strategy: 'normal', rbfByDefault: true },
                dogecoin: { strategy: 'economy', rbfByDefault: true },
                absent: undefined,
            },
        });

        expect(migrated.ads.perChain).toEqual({
            seeded: { perTxAmountSats: null, triggerAmountSats: null },
            custom: { perTxAmountSats: 2, triggerAmountSats: 2000 },
            absent: { perTxAmountSats: null, triggerAmountSats: null },
        });
        expect(migrated.fees).toEqual({
            bitcoin: { strategy: null, rbfByDefault: null },
            dogecoin: { strategy: 'economy', rbfByDefault: true },
            absent: { strategy: null, rbfByDefault: null },
        });
    });

    it('preserves populated pending transaction fields', () => {
        expect(pendingTxMigrations[1]({
            schemaVersion: 1,
            tick: 'XCP',
            amount: '2',
            params: { memo: 'kept' },
        })).toMatchObject({
            schemaVersion: 2,
            tick: 'XCP',
            amount: '2',
            params: { memo: 'kept' },
        });
    });
});
