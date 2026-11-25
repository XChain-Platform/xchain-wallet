// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    AUTHORABLE_ACTIONS,
    CHAIN_GATED_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';
import {
    SIGN_ACTION_ENABLED,
    SIGN_ACTION_REFUSED,
} from '../../../packages/extension/src/bridge/signActionEnabled.js';
import {
    MATRIX_STAGES,
    cutSignActionLists,
    matrixVerdict,
} from '../../e2e/fixtures/signActionMatrix.js';

const passingStages = () => ({
    compose: true,
    describe: true,
    tamper: true,
    submit: true,
});

describe('sign action matrix', () => {
    it('keeps the required stage order frozen', () => {
        expect(MATRIX_STAGES).toEqual(['compose', 'describe', 'tamper', 'submit']);
        expect(Object.isFrozen(MATRIX_STAGES)).toBe(true);
    });

    it('reproduces the matrix-derived lists from all 32 passing runs', () => {
        const results = AUTHORABLE_ACTIONS.map((action) => ({
            action,
            stages: passingStages(),
        }));
        const lists = cutSignActionLists(results, {
            authorable: AUTHORABLE_ACTIONS,
            gated: CHAIN_GATED_ACTIONS,
        });

        expect(results).toHaveLength(32);
        expect(lists.enabled).toHaveLength(27);
        expect(Object.keys(lists.refused)).toHaveLength(5);
        expect(lists.enabled).toEqual(SIGN_ACTION_ENABLED);
        expect(lists.refused).toEqual(SIGN_ACTION_REFUSED);
    });

    it('reports the first failed stage in matrix order', () => {
        expect(matrixVerdict({
            action: 'SEND',
            stages: { ...passingStages(), describe: false, tamper: false },
        })).toEqual({ action: 'SEND', passed: false, failedStage: 'describe' });
    });

    it('fails closed when a stage is missing', () => {
        const stages = passingStages();
        delete stages.tamper;

        expect(matrixVerdict({ action: 'SEND', stages })).toEqual({
            action: 'SEND',
            passed: false,
            failedStage: 'tamper',
        });
    });

    it('requires stage evidence to be exactly true', () => {
        expect(matrixVerdict({
            action: 'SEND',
            stages: { ...passingStages(), compose: 'yes' },
        })).toEqual({ action: 'SEND', passed: false, failedStage: 'compose' });
    });

    it('keeps a passing COLLECT run refused while COLLECT is gated', () => {
        const lists = cutSignActionLists([
            { action: 'COLLECT', stages: passingStages() },
        ], {
            authorable: ['COLLECT'],
            gated: ['COLLECT'],
        });

        expect(lists.enabled).toEqual([]);
        expect(lists.refused).toEqual({ COLLECT: 'chain-gated' });
    });

    it('partitions every authorable action for passing, failing, and absent runs', () => {
        const lists = cutSignActionLists([
            { action: 'SEND', stages: passingStages() },
            { action: 'SWEEP', stages: { ...passingStages(), describe: false } },
        ], {
            authorable: ['SWEEP', 'ADDRESS', 'SEND'],
        });

        expect(lists.enabled).toEqual(['SEND']);
        expect(lists.refused).toEqual({
            ADDRESS: 'not yet proven on regtest',
            SWEEP: 'failed describe on regtest',
        });
        expect([...lists.enabled, ...Object.keys(lists.refused)].sort()).toEqual([
            'ADDRESS',
            'SEND',
            'SWEEP',
        ]);
    });

    it('freezes both lists without changing its inputs', () => {
        const results = [{ action: 'SEND', stages: passingStages() }];
        const options = { authorable: ['SWEEP', 'SEND'], gated: ['SWEEP'] };
        const beforeResults = structuredClone(results);
        const beforeOptions = structuredClone(options);

        const lists = cutSignActionLists(results, options);

        expect(Object.isFrozen(lists.enabled)).toBe(true);
        expect(Object.isFrozen(lists.refused)).toBe(true);
        expect(results).toEqual(beforeResults);
        expect(options).toEqual(beforeOptions);
    });

    it('rejects an unknown result action and names it', () => {
        expect(() => cutSignActionLists([
            { action: 'UNKNOWN', stages: passingStages() },
        ], { authorable: ['SEND'] })).toThrowError(TypeError);
        expect(() => cutSignActionLists([
            { action: 'UNKNOWN', stages: passingStages() },
        ], { authorable: ['SEND'] })).toThrow('UNKNOWN');
    });

    it('rejects a duplicate result and names its action', () => {
        expect(() => cutSignActionLists([
            { action: 'SEND', stages: passingStages() },
            { action: 'SEND', stages: passingStages() },
        ], { authorable: ['SEND'] })).toThrow('SEND');
    });

    it('rejects an unknown gated action and names it', () => {
        expect(() => cutSignActionLists([], {
            authorable: ['SEND'],
            gated: ['UNKNOWN'],
        })).toThrow('UNKNOWN');
    });

    it('rejects invalid matrix results and actions', () => {
        expect(() => matrixVerdict(null)).toThrow(TypeError);
        expect(() => matrixVerdict({ action: '', stages: passingStages() })).toThrow(TypeError);
    });
});
