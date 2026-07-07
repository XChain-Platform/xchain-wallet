// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sanitizeAbi guards ExecuteContractForm's render path: the contract `abi` is
// deployer-controlled display metadata the explorer relays verbatim, and a
// method whose `params` is not an array would throw on `.map` at render. With
// no ErrorBoundary in the wallet that white-screens the whole SPA, so every
// kept method MUST come back with an array `params`. These cases lock that in.

import { describe, it, expect } from 'vitest';
import { extractSingle, sanitizeAbi } from '../../../packages/core/src/shared/routes/contractResponseShape.js';

describe('sanitizeAbi', () => {
    it('drops a method whose params is a string (the render-crash input)', () => {
        // string params -> method dropped -> no methods left -> null (manual lane)
        const out = sanitizeAbi({ version: 1, methods: { transfer: { params: 'amount,to' } } });
        expect(out).toBeNull();
    });

    it('drops a method whose params is a non-array object, keeps valid siblings', () => {
        const out = sanitizeAbi({
            version: 1,
            methods: {
                good: { summary: 'ok', view: true, params: [{ name: 'x', type: 'amount' }] },
                bad:  { params: { a: 1 } },
            },
        });
        expect(Object.keys(out.methods)).toEqual(['good']);
        expect(Array.isArray(out.methods.good.params)).toBe(true);
        expect(out.methods.good).toMatchObject({ summary: 'ok', view: true });
    });

    it('treats missing params as an empty array (view function)', () => {
        const out = sanitizeAbi({ version: 1, methods: { info: { view: true } } });
        expect(out.methods.info.params).toEqual([]);
        expect(out.methods.info.view).toBe(true);
    });

    it('filters non-object param entries', () => {
        const out = sanitizeAbi({ version: 1, methods: { f: { params: [null, 'str', { name: 'y', type: 'tick' }] } } });
        expect(out.methods.f.params).toEqual([{ name: 'y', type: 'tick' }]);
    });

    it('every kept method always exposes an array params (invariant across shapes)', () => {
        const out = sanitizeAbi({
            version: 2,
            methods: {
                a: { params: [{ name: 'p', type: 'string' }] },
                b: { params: [] },
                c: { summary: 's' },
            },
        });
        for (const m of Object.values(out.methods)) expect(Array.isArray(m.params)).toBe(true);
    });

    it('returns null for structurally absent or malformed abis', () => {
        expect(sanitizeAbi(null)).toBeNull();
        expect(sanitizeAbi(undefined)).toBeNull();
        expect(sanitizeAbi({})).toBeNull();
        expect(sanitizeAbi({ version: 1 })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: 'nope' })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: {} })).toBeNull();
        expect(sanitizeAbi({ version: 1, methods: { onlyBad: { params: 42 } } })).toBeNull();
    });
});

describe('extractSingle', () => {
    it('unwraps the explorer single-record shapes to the row', () => {
        const row = { action_index: 5 };
        expect(extractSingle({ data: row })).toBe(row);
        expect(extractSingle({ data: [row] })).toBe(row);
        expect(extractSingle([row])).toBe(row);
        expect(extractSingle(row)).toBe(row);
        expect(extractSingle(null)).toBeNull();
    });
});
