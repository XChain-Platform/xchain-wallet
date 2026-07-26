// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-36 atomic BATCH composer: the COMMAND assembly + constraint pre-check.
// validateBatchConstraints mirrors the SDK BatchBuilder rules for live UI
// feedback; buildBatchCommand drives the real BatchBuilder and recovers the
// COMMAND for the generic advancedAction signing path.

import { describe, it, expect, vi } from 'vitest';
import {
    validateBatchConstraints,
    buildBatchCommand,
    BATCH_FORBIDDEN_ACTIONS,
    BATCH_SINGLETON_ACTIONS,
} from '../../../packages/core/src/flows/batchCommand.js';

describe('validateBatchConstraints (PC-36 pre-check)', () => {
    it('flags an empty queue', () => {
        expect(validateBatchConstraints([])).toEqual([expect.stringMatching(/at least one/i)]);
    });

    it('accepts a legal mix', () => {
        const errs = validateBatchConstraints([
            { action: 'SEND' }, { action: 'ISSUE' }, { action: 'MINT' }, { action: 'BROADCAST' },
        ]);
        expect(errs).toEqual([]);
    });

    it('rejects nested BATCH and DEPLOY', () => {
        const errs = validateBatchConstraints([{ action: 'BATCH' }, { action: 'DEPLOY' }]);
        expect(errs.some((e) => /another batch/i.test(e))).toBe(true);
        expect(errs.some((e) => /DEPLOY/.test(e))).toBe(true);
    });

    it('enforces at most one ISSUE / MINT / FILE', () => {
        for (const action of BATCH_SINGLETON_ACTIONS) {
            const errs = validateBatchConstraints([{ action }, { action }]);
            expect(errs.some((e) => new RegExp(`at most one ${action}`, 'i').test(e))).toBe(true);
        }
    });

    it('is case-insensitive on action names', () => {
        expect(validateBatchConstraints([{ action: 'batch' }]).some((e) => /another batch/i.test(e))).toBe(true);
        expect(BATCH_FORBIDDEN_ACTIONS).toEqual(['BATCH', 'DEPLOY']);
    });
});

describe('buildBatchCommand (PC-36 compose)', () => {
    function fakeSdk(actionString) {
        const builder = { add: vi.fn(() => builder), build: vi.fn(async () => ({ actionString })) };
        return { batch: vi.fn(() => builder), _builder: builder };
    }
    const reg = (sdk) => ({ get: vi.fn(() => sdk) });

    it('queues every sub-action and recovers COMMAND from the BATCH string', async () => {
        const sdk = fakeSdk('BATCH|0|SEND|0|PEPE|1|addr|;MINT|1|PEPE|5|');
        const subActions = [
            { action: 'SEND', params: { TICK: 'PEPE' } },
            { action: 'MINT', params: { TICK: 'PEPE' } },
        ];
        const out = await buildBatchCommand({ sdkRegistry: reg(sdk), chainId: 'c', subActions });
        expect(sdk._builder.add).toHaveBeenCalledTimes(2);
        expect(sdk._builder.add).toHaveBeenNthCalledWith(1, 'SEND', { TICK: 'PEPE' });
        expect(out.command).toBe('SEND|0|PEPE|1|addr|;MINT|1|PEPE|5|');
        expect(out.subStrings).toEqual(['SEND|0|PEPE|1|addr|', 'MINT|1|PEPE|5|']);
    });

    it('throws on a non-BATCH action string (format drift guard)', async () => {
        const sdk = fakeSdk('SEND|0|PEPE|1|addr|');
        await expect(buildBatchCommand({ sdkRegistry: reg(sdk), chainId: 'c', subActions: [{ action: 'SEND', params: {} }] }))
            .rejects.toThrow(/unexpected BATCH action string/);
    });

    it('validates required args', async () => {
        await expect(buildBatchCommand({ sdkRegistry: null, chainId: 'c', subActions: [{ action: 'SEND' }] }))
            .rejects.toThrow(/sdkRegistry is required/);
        await expect(buildBatchCommand({ sdkRegistry: reg(fakeSdk('BATCH|0|x')), chainId: 'c', subActions: [] }))
            .rejects.toThrow(/at least one sub-action/);
    });

    it('surfaces a missing BATCH capability', async () => {
        await expect(buildBatchCommand({ sdkRegistry: reg({}), chainId: 'c', subActions: [{ action: 'SEND' }] }))
            .rejects.toThrow(/no BATCH support/);
    });
});
