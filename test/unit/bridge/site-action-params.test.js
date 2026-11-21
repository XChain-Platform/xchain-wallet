// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { screenSiteActionParams } from '../../../packages/extension/src/bridge/siteActionParams.js';

describe('screenSiteActionParams', () => {
    it.each([null, undefined, true, 42, 'params', Symbol('params'), () => ({})])(
        'refuses non-object input %#',
        (params) => {
            expect(screenSiteActionParams(params)).toEqual({
                ok: false,
                code: 'INVALID_PARAMS',
                fields: [],
            });
        },
    );

    it('reports every present refused field in contract order', () => {
        const params = {
            encoding: undefined,
            utxos: [],
            legs: [],
            customOutputs: null,
            prebuiltPsbt: false,
        };

        expect(screenSiteActionParams(params)).toEqual({
            ok: false,
            code: 'INVALID_PARAMS',
            fields: ['legs', 'prebuiltPsbt', 'utxos', 'customOutputs', 'encoding'],
        });
    });

    it('refuses a forbidden field inherited from the prototype', () => {
        const params = Object.create({ utxos: [] });
        params.action = 'SEND';

        expect(screenSiteActionParams(params)).toEqual({
            ok: false,
            code: 'INVALID_PARAMS',
            fields: ['utxos'],
        });
    });

    it('returns a null-prototype shallow copy without fee controls', () => {
        const nested = { tick: 'BTC' };
        const marker = Symbol('marker');
        const params = {
            action: 'SEND',
            nested,
            fee: 1,
            feePerKb: 2,
            rbf: true,
            [marker]: 'kept',
        };

        const result = screenSiteActionParams(params);

        expect(result.ok).toBe(true);
        expect(Object.getPrototypeOf(result.params)).toBe(null);
        expect(Reflect.ownKeys(result.params)).toEqual(['action', 'nested', marker]);
        expect(result.params.action).toBe('SEND');
        expect(result.params.nested).toBe(nested);
        expect(result.params[marker]).toBe('kept');
        expect(params).toEqual({
            action: 'SEND',
            nested,
            fee: 1,
            feePerKb: 2,
            rbf: true,
            [marker]: 'kept',
        });
    });

    it('does not copy an inherited __proto__ key', () => {
        const prototype = Object.create(null);
        Object.defineProperty(prototype, '__proto__', {
            value: { polluted: true },
            enumerable: true,
        });
        const params = Object.create(prototype);
        params.action = 'SEND';

        const result = screenSiteActionParams(params);

        expect(result.ok).toBe(true);
        expect(Object.getPrototypeOf(result.params)).toBe(null);
        expect(Object.hasOwn(result.params, '__proto__')).toBe(false);
        expect(result.params.polluted).toBeUndefined();
        expect(result.params.action).toBe('SEND');
    });

    it('copies an own __proto__ key as inert data', () => {
        const params = JSON.parse('{"action":"SEND","__proto__":{"polluted":true}}');

        const result = screenSiteActionParams(params);

        expect(result.ok).toBe(true);
        expect(Object.getPrototypeOf(result.params)).toBe(null);
        expect(Object.hasOwn(result.params, '__proto__')).toBe(true);
        expect(result.params.__proto__).toEqual({ polluted: true });
        expect(result.params.polluted).toBeUndefined();
    });
});
