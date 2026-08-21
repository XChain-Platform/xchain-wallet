// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The registry's change channel (§9.7 hot-swap contract). Before this landed,
// applyRemoteDescriptors mutated entries with no version counter and no
// subscription, so UI surfaces that snapshotted supportedChains() at module
// scope froze their gating at import and the boot sync (which lands AFTER
// mount) never reached them. These pin: every mutation bumps the version and
// notifies; a fully-skipped remote batch does not; a throwing listener never
// starves the rest; unsubscribe works.

import { describe, it, expect, vi } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

function customChain(id = 'custom-regtest') {
    const base = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
    return { ...base, id, displayName: 'Custom', supportedActions: ['SEND'] };
}

describe('ChainRegistry change channel', () => {
    it('starts at version 0 and bumps on addCustom / removeCustom', () => {
        const reg = new ChainRegistry();
        const fn = vi.fn();
        const off = reg.subscribe(fn);
        expect(reg.getVersion()).toBe(0);

        reg.addCustom(customChain());
        expect(reg.getVersion()).toBe(1);
        expect(fn).toHaveBeenCalledTimes(1);

        expect(reg.removeCustom('custom-regtest')).toBe(true);
        expect(reg.getVersion()).toBe(2);
        expect(fn).toHaveBeenCalledTimes(2);

        // Removing an unknown id changes nothing and must not notify.
        expect(reg.removeCustom('nope')).toBe(false);
        expect(reg.getVersion()).toBe(2);
        expect(fn).toHaveBeenCalledTimes(2);

        off();
        reg.addCustom(customChain('custom-2'));
        expect(fn).toHaveBeenCalledTimes(2);
        expect(reg.getVersion()).toBe(3);
    });

    it('applyRemoteDescriptors notifies when it adds or updates, not on a fully-skipped batch', () => {
        const reg = new ChainRegistry();
        reg.addCustom(customChain('remote-1'));
        const fn = vi.fn();
        reg.subscribe(fn);
        const v0 = reg.getVersion();

        // The user's copy wins, so this batch is entirely skipped.
        const skipped = reg.applyRemoteDescriptors([customChain('remote-1')]);
        expect(skipped.skipped).toEqual(['remote-1']);
        expect(reg.getVersion()).toBe(v0);
        expect(fn).not.toHaveBeenCalled();

        // A widened supportedActions on a bundled chain is an update, and the
        // new list is what supportedChains() returns afterwards.
        const btc = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
        const r = reg.applyRemoteDescriptors([{ ...btc, supportedActions: [...btc.supportedActions, 'NEWTHING'] }]);
        expect(r.updated).toEqual(['bitcoin-regtest']);
        expect(reg.getVersion()).toBe(v0 + 1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(reg.get('bitcoin-regtest').supportedActions).toContain('NEWTHING');
    });

    it('a throwing listener does not starve the others, and version still bumps', () => {
        const reg = new ChainRegistry();
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        reg.subscribe(bad);
        reg.subscribe(good);
        expect(() => reg.addCustom(customChain())).not.toThrow();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
        expect(reg.getVersion()).toBe(1);
    });
});
