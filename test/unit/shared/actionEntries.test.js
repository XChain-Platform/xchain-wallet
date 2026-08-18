// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the Actions menu entry list, which used to be copy-pasted into all
// three shells.
//
// Two behaviours are worth pinning, because both were regressions in the
// shipped triplicate:
//
//   - AN UNARMED ENTRY MUST NOT RENDER. Desktop and the extension popup had
//     no filter, so `onMultisigCreate: hasBtcAddress ? fn : undefined` put a
//     live button on screen whose onClick was undefined. ActionsMenu passes
//     `onClick={e.onSelect}` straight through, so that is a button that does
//     nothing when tapped, not a disabled one.
//   - THE COPY IS ONE STRING PER ENTRY. Eleven descriptions had drifted
//     between the three copies. A single list cannot drift, and the sweep
//     below is what keeps a future edit from re-introducing a per-shell
//     variant through the capability hook.

import { describe, it, expect } from 'vitest';
import {
    ACTION_ENTRY_DEFS,
    buildActionEntries,
} from '../../../packages/core/src/shared/actionEntries.js';

const noop = () => {};

/** Arm every entry, so the filter is not what is under test. */
const allHandlers = () => Object.fromEntries(
    ACTION_ENTRY_DEFS.map((d) => [d.handler, noop]),
);

describe('ACTION_ENTRY_DEFS', () => {
    it('has a unique id and a unique handler name per entry', () => {
        const ids = ACTION_ENTRY_DEFS.map((d) => d.id);
        const handlers = ACTION_ENTRY_DEFS.map((d) => d.handler);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(handlers).size).toBe(handlers.length);
    });

    it('gives every entry a label and a description', () => {
        for (const def of ACTION_ENTRY_DEFS) {
            expect(def.label, `${def.id} label`).toBeTruthy();
            expect(def.description, `${def.id} description`).toBeTruthy();
        }
    });

    it('is frozen, so a shell cannot mutate the menu for the others', () => {
        expect(Object.isFrozen(ACTION_ENTRY_DEFS)).toBe(true);
    });
});

describe('buildActionEntries', () => {
    it('renders an entry only when its handler is a function', () => {
        const entries = buildActionEntries({
            onIssue: noop,
            onMint: noop,
            // Capability-gated the way the shells write it.
            onMultisigCreate: undefined,
            onMultisigSign: undefined,
            onCoSignerAccounts: undefined,
        });
        expect(entries.map((e) => e.id)).toEqual(['issue', 'mint']);
    });

    it('drops a non-function handler rather than trusting truthiness', () => {
        const entries = buildActionEntries({ onIssue: 'yes', onMint: noop });
        expect(entries.map((e) => e.id)).toEqual(['mint']);
    });

    it('returns an empty list when nothing is armed', () => {
        expect(buildActionEntries()).toEqual([]);
        expect(buildActionEntries({})).toEqual([]);
    });

    it('never yields an entry whose onSelect is not callable', () => {
        // The dead-button guard, stated as the property the shells rely on.
        const partial = Object.fromEntries(
            ACTION_ENTRY_DEFS.map((d, i) => [d.handler, i % 2 ? noop : undefined]),
        );
        for (const entry of buildActionEntries(partial)) {
            expect(typeof entry.onSelect, `${entry.id} onSelect`).toBe('function');
        }
    });

    it('keeps the declared order and wires each handler to its own entry', () => {
        const seen = [];
        const handlers = Object.fromEntries(
            ACTION_ENTRY_DEFS.map((d) => [d.handler, () => seen.push(d.handler)]),
        );
        const entries = buildActionEntries(handlers);
        expect(entries.map((e) => e.id)).toEqual(ACTION_ENTRY_DEFS.map((d) => d.id));
        for (const entry of entries) entry.onSelect();
        expect(seen).toEqual(ACTION_ENTRY_DEFS.map((d) => d.handler));
    });

    it('offers Trezor only to a host that pairs one', () => {
        const pairSigner = (caps) => buildActionEntries(allHandlers(), caps)
            .find((e) => e.id === 'pair-signer');
        expect(pairSigner({ pairsTrezor: true }).description).toMatch(/Trezor or Ledger/);
        expect(pairSigner({ pairsTrezor: false }).description).not.toMatch(/Add a Trezor/);
        expect(pairSigner({ pairsTrezor: false }).description).toMatch(/Ledger/);
    });

    it('defaults to no Trezor, so an undeclared host cannot over-promise', () => {
        const entry = buildActionEntries(allHandlers()).find((e) => e.id === 'pair-signer');
        expect(entry.description).not.toMatch(/Add a Trezor/);
    });

    it('varies no copy but the one capability line', () => {
        // Any future per-host branch has to show up here as a diff, which is
        // how the drift that motivated this module stays fixed.
        const withTrezor = buildActionEntries(allHandlers(), { pairsTrezor: true });
        const withoutTrezor = buildActionEntries(allHandlers(), { pairsTrezor: false });
        const differing = withTrezor
            .filter((e, i) => e.description !== withoutTrezor[i].description)
            .map((e) => e.id);
        expect(differing).toEqual(['pair-signer']);
        for (const e of withTrezor) {
            if (e.id === 'pair-signer') continue;
            const def = ACTION_ENTRY_DEFS.find((d) => d.id === e.id);
            expect(e.description).toBe(def.description);
            expect(e.label).toBe(def.label);
        }
    });

    it('hands back a fresh array each call, not the shared defs', () => {
        const a = buildActionEntries(allHandlers());
        const b = buildActionEntries(allHandlers());
        expect(a).not.toBe(b);
        expect(a[0]).not.toBe(ACTION_ENTRY_DEFS[0]);
        expect(Object.isFrozen(ACTION_ENTRY_DEFS[0])).toBe(false);
        expect(ACTION_ENTRY_DEFS.some((d) => 'onSelect' in d)).toBe(false);
    });
});
