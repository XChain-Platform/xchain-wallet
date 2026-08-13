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
    classifyIssueTick,
    BATCH_FORBIDDEN_ACTIONS,
    BATCH_SINGLETON_ACTIONS,
    BATCH_MAX_COMMANDS,
} from '../../../packages/core/src/flows/batchCommand.js';

describe('validateBatchConstraints (PC-36 pre-check)', () => {
    it('flags an empty queue', () => {
        expect(validateBatchConstraints([])).toEqual([expect.stringMatching(/at least one/i)]);
    });

    it('accepts a legal mix', () => {
        const errs = validateBatchConstraints([
            { action: 'SEND' }, { action: 'ISSUE', params: { TICK: 'JDOG' } }, { action: 'MINT' }, { action: 'BROADCAST' },
        ]);
        expect(errs).toEqual([]);
    });

    it('rejects a nested BATCH, but a lone DEPLOY is legal (the chain accepts exactly one)', () => {
        const errs = validateBatchConstraints([{ action: 'BATCH' }, { action: 'DEPLOY' }]);
        expect(errs.some((e) => /another batch/i.test(e))).toBe(true);
        expect(errs.some((e) => /DEPLOY/.test(e))).toBe(false);
    });

    it('accepts a single DEPLOY', () => {
        const errs = validateBatchConstraints([{ action: 'SEND' }, { action: 'DEPLOY' }]);
        expect(errs).toEqual([]);
    });

    it('rejects two DEPLOYs (one VM constructor run is already the most expensive command)', () => {
        const errs = validateBatchConstraints([{ action: 'DEPLOY' }, { action: 'DEPLOY' }]);
        expect(errs.some((e) => /at most one DEPLOY/i.test(e))).toBe(true);
    });

    it('enforces at most one FILE', () => {
        const errs = validateBatchConstraints([{ action: 'FILE' }, { action: 'FILE' }]);
        expect(errs.some((e) => /at most one FILE/i.test(e))).toBe(true);
    });

    it('accepts MINTs of two distinct tokens', () => {
        const errs = validateBatchConstraints([
            { action: 'MINT', params: { TICK: 'JDOG' } },
            { action: 'MINT', params: { TICK: 'PEPE' } },
        ]);
        expect(errs).toEqual([]);
    });

    it('rejects two MINTs of the same token', () => {
        const errs = validateBatchConstraints([
            { action: 'MINT', params: { TICK: 'JDOG' } },
            { action: 'MINT', params: { TICK: 'JDOG' } },
        ]);
        expect(errs.some((e) => /mint each token at most once/i.test(e))).toBe(true);
    });

    it('refuses a MINT pair naming a token once by name and once by ID number, since they might be the same token', () => {
        const errs = validateBatchConstraints([
            { action: 'MINT', params: { TICK: 'JDOG' } },
            { action: 'MINT', params: { TICK: '^614' } },
        ]);
        expect(errs.some((e) => /spell every token by name/i.test(e))).toBe(true);
        // The ambiguous case reports on its own; it should not also claim an
        // ordinary duplicate, which would imply a certainty the wallet lacks.
        expect(errs.some((e) => /mint each token at most once/i.test(e))).toBe(false);
    });

    it('is case-insensitive on action names', () => {
        expect(validateBatchConstraints([{ action: 'batch' }]).some((e) => /another batch/i.test(e))).toBe(true);
        expect(BATCH_FORBIDDEN_ACTIONS).toEqual(['BATCH']);
        expect(BATCH_SINGLETON_ACTIONS).toEqual(['ISSUE', 'DEPLOY', 'FILE']);
    });

    it('accepts one top-level ISSUE plus any number of child ISSUEs', () => {
        const subActions = [
            { action: 'ISSUE', params: { TICK: 'JDOG' } },
            ...Array.from({ length: 50 }, (_, i) => ({ action: 'ISSUE', params: { TICK: `JDOG.${i + 1}` } })),
        ];
        expect(validateBatchConstraints(subActions)).toEqual([]);
    });

    it('rejects two undotted top-level ISSUEs', () => {
        const errs = validateBatchConstraints([
            { action: 'ISSUE', params: { TICK: 'JDOG' } },
            { action: 'ISSUE', params: { TICK: 'PEPE' } },
        ]);
        expect(errs.some((e) => /at most one ISSUE/i.test(e))).toBe(true);
    });

    it('rejects two caret ISSUEs: a caret TICK is never exempt even with a dot', () => {
        const errs = validateBatchConstraints([
            { action: 'ISSUE', params: { TICK: '^12.1' } },
            { action: 'ISSUE', params: { TICK: '^12.2' } },
        ]);
        expect(errs.some((e) => /at most one ISSUE/i.test(e))).toBe(true);
    });

    it('does not treat a caret-dotted TICK as a child (classifier)', () => {
        expect(classifyIssueTick({ params: { TICK: '^12.5' } })).toBe('TOP_LEVEL');
        expect(classifyIssueTick({ params: { TICK: 'JDOG.1' } })).toBe('CHILD');
        expect(classifyIssueTick({ params: { TICK: 'JDOG' } })).toBe('TOP_LEVEL');
        expect(classifyIssueTick({ params: {} })).toBe('TOP_LEVEL');
    });

    it('rejects a parent ISSUE plus a caret entry: the caret entry is TOP_LEVEL too', () => {
        const errs = validateBatchConstraints([
            { action: 'ISSUE', params: { TICK: 'JDOG' } },
            { action: 'ISSUE', params: { TICK: '^12.1' } },
        ]);
        expect(errs.some((e) => /at most one ISSUE/i.test(e))).toBe(true);
    });

    it('rejects a nested BATCH amid otherwise-legal child ISSUEs and DEPLOYs, but only for the nesting and the SECOND DEPLOY', () => {
        const errs = validateBatchConstraints([
            { action: 'ISSUE', params: { TICK: 'JDOG' } },
            { action: 'ISSUE', params: { TICK: 'JDOG.1' } },
            { action: 'BATCH' },
            { action: 'DEPLOY' },
            { action: 'DEPLOY' },
        ]);
        expect(errs.some((e) => /another batch/i.test(e))).toBe(true);
        expect(errs.some((e) => /at most one DEPLOY/i.test(e))).toBe(true);
    });

    it('accepts exactly 250 commands', () => {
        const subActions = Array.from({ length: BATCH_MAX_COMMANDS }, () => ({ action: 'SEND' }));
        expect(validateBatchConstraints(subActions)).toEqual([]);
    });

    it('rejects 251 commands with a clear cap message', () => {
        const subActions = Array.from({ length: BATCH_MAX_COMMANDS + 1 }, () => ({ action: 'SEND' }));
        const errs = validateBatchConstraints(subActions);
        expect(errs.some((e) => /at most 250 actions/i.test(e))).toBe(true);
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
