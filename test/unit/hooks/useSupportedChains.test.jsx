// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSupportedChains / useChainIdsWithAction re-render on a registry mutation.
// This is the §9.7 hot-swap contract made testable: a surface gated on these
// hooks sees a synced or user-added descriptor WITHOUT a restart, where the
// old module-scope `chainRegistry.supportedChains().filter(...)` snapshot did
// not. Also pins the referential stability the hook promises to effect deps
// (same array across re-renders with no mutation), and the audit that no
// surface still freezes the list at module scope.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import {
    useSupportedChains,
    useChainIdsWithAction,
    chainIdsWithAction,
} from '../../../packages/core/src/shared/hooks/useSupportedChains.js';

const btcRegtest = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');

describe('useSupportedChains', () => {
    it('re-renders with the new list when a remote batch lands after mount', () => {
        const reg = new ChainRegistry();
        const { result } = renderHook(() => useChainIdsWithAction('NEWACTION', reg));
        expect(result.current).toEqual([]);

        act(() => {
            reg.applyRemoteDescriptors([{ ...btcRegtest, supportedActions: [...btcRegtest.supportedActions, 'NEWACTION'] }]);
        });
        expect(result.current).toEqual(['bitcoin-regtest']);
    });

    it('tracks addCustom / removeCustom (Developer Mode)', () => {
        const reg = new ChainRegistry();
        const { result } = renderHook(() => useSupportedChains(reg));
        const before = result.current.length;

        act(() => { reg.addCustom({ ...btcRegtest, id: 'custom-x', displayName: 'X' }); });
        expect(result.current.length).toBe(before + 1);
        expect(result.current.some((d) => d.id === 'custom-x')).toBe(true);

        act(() => { reg.removeCustom('custom-x'); });
        expect(result.current.length).toBe(before);
    });

    it('returns a referentially stable array between mutations (safe as an effect dep)', () => {
        const reg = new ChainRegistry();
        const { result, rerender } = renderHook(() => useChainIdsWithAction('DEPLOY', reg));
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
        act(() => { reg.addCustom({ ...btcRegtest, id: 'custom-y', displayName: 'Y' }); });
        expect(result.current).not.toBe(first);
    });

    it('chainIdsWithAction is the non-hook twin and reads at call time', () => {
        const reg = new ChainRegistry();
        expect(chainIdsWithAction('ZZZ', reg)).toEqual([]);
        reg.applyRemoteDescriptors([{ ...btcRegtest, supportedActions: ['ZZZ'] }]);
        expect(chainIdsWithAction('ZZZ', reg)).toEqual(['bitcoin-regtest']);
    });
});

// Audit: no module under shared/ may snapshot supportedChains() at module
// scope again. The registry hot-swaps after import, so a top-level
// `const X = chainRegistry.supportedChains()...` is frozen gating by
// construction. Body-level reads (inside a function / hook) are fine.
describe('no module-scope supportedChains() snapshots under shared/', () => {
    const root = join(process.cwd(), 'packages', 'core', 'src', 'shared');
    function walk(dir, out = []) {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p, out);
            else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
        }
        return out;
    }
    it('finds none', () => {
        const offenders = [];
        for (const file of walk(root)) {
            const src = readFileSync(file, 'utf8');
            // Top-level (column 0) const/let/export const that calls supportedChains()
            // on the same statement, possibly spanning a newline before the call.
            const re = /^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*\w+\s*\n?\s*\.supportedChains\(\)/m;
            if (re.test(src)) offenders.push(file.replace(process.cwd() + '/', ''));
        }
        expect(offenders).toEqual([]);
    });
});
