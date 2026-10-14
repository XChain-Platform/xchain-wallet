// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    assertActionAllowedOnChain,
    assertValidatorLaneChain,
    isActionDataOfferedInBuild,
    isActionOfferedInBuild,
    isActionOfferedOnChain,
    validatorLaneChainIds,
} from '../../../packages/core/src/registry/actions.js';

const registry = {
    get: (id) => ({ btc: { coin: 'bitcoin' }, ltc: { coin: 'litecoin' } })[id],
};

describe('registry action edge branches', () => {
    it('treats absent and unknown chains as outside the validator lane', () => {
        expect(validatorLaneChainIds(null, registry)).toEqual([]);
        expect(validatorLaneChainIds(['btc', 'missing'], null)).toEqual([]);
        expect(() => assertValidatorLaneChain(registry, 'missing', 'composer'))
            .toThrow('composer: validator staking actions are accepted on Bitcoin only, not on missing');
    });

    it('normalizes action names before applying per-version chain gates', () => {
        expect(() => assertActionAllowedOnChain(registry, 'ltc', 'stake', 1, 'composer'))
            .toThrow('composer: STAKE version 1 is accepted on Bitcoin only, not on ltc');
        expect(() => assertActionAllowedOnChain(registry, 'btc', 'xbridge', 1, 'composer'))
            .toThrow('composer: XBRIDGE version 1 is not accepted on Bitcoin');
        expect(() => assertActionAllowedOnChain(registry, 'ltc', '', 0, 'composer')).not.toThrow();
    });

    it('only hides actions that are refused at every version', () => {
        expect(isActionOfferedOnChain(registry, 'missing', 'collect')).toBe(false);
        expect(isActionOfferedOnChain(registry, 'missing', 'stake')).toBe(true);
        expect(isActionOfferedOnChain(registry, 'missing', undefined)).toBe(true);
    });

    it('keeps default builds permissive and normalizes picker input', () => {
        expect(isActionOfferedInBuild('  swap  ', { hasDexSurface: false })).toBe(false);
        expect(isActionOfferedInBuild(null, { hasDexSurface: false })).toBe(true);
        expect(isActionOfferedInBuild('ORDER', {})).toBe(true);
    });

    it('scans flattened string params and repeated BATCH prefixes', () => {
        const actionData = {
            action: ' batch ',
            params: {
                ignored: 42,
                commands: [
                    'SEND|0|XCP|1|dest',
                    'BATCH|0|BATCH|1| "swap" |0|XCP|1',
                ],
            },
        };
        expect(isActionDataOfferedInBuild(actionData, { hasDexSurface: false })).toBe(false);
        expect(isActionDataOfferedInBuild(actionData, { hasDexSurface: true })).toBe(true);
    });

    it('accepts missing params and non-BATCH actions after the top-level gate', () => {
        expect(isActionDataOfferedInBuild({ action: 'BATCH' }, { hasDexSurface: false })).toBe(true);
        expect(isActionDataOfferedInBuild({ action: 'SEND', params: { memo: 'SWAP|0' } }, { hasDexSurface: false }))
            .toBe(true);
        expect(isActionDataOfferedInBuild(undefined, { hasDexSurface: false })).toBe(true);
    });
});
