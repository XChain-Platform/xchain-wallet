// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : Home accepted an `extraActions` array, documented it as "§40+
// entries surfaced in the small-mode pancake drawer", destructured it,
// and then never rendered it. The web shell dutifully built 24 real
// entries for it on every render. A documented prop with no consumer
// reads exactly like a shipped feature, so nobody noticed the entries
// went nowhere, and the next person looking for the small-mode action
// surface wired into the same dead slot.
//
// Two guards:
//   1. Home declares no prop it never reads, so the next dead slot can't
//      ship silently (the general class, not just `extraActions`).
//   2. The small variant really can reach the §40 entries by the route
//      that IS live: pancake menu -> "More actions" -> ActionsMenu, which
//      renders every entry in the small variant too. That is what makes
//      removing the prop the right fix rather than a capability loss.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
// `?raw` keeps the source read anchored to this file's own import
// resolution, so the guard works from any cwd (jsdom's import.meta.url
// is not a file: URL, so node:fs + fileURLToPath is not an option here).
import homeSource from '../../../packages/core/src/shared/routes/Home.jsx?raw';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MenuRoute } from '../../../packages/core/src/shared/routes/MenuRoute.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';

/**
 * Local names bound by `export function Home({ ... })`, with `a: b`
 * renames resolved to the local binding (`b`) and defaults stripped.
 */
function homePropBindings(src) {
    const sig = src.match(/export function Home\(\{([\s\S]*?)\}\)\s*\{/);
    if (!sig) throw new Error('Home props signature not found');
    const names = sig[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (part.includes(':')
            ? part.split(':')[1].trim()
            : part.split('=')[0].trim()));
    return { names, body: src.slice(sig.index + sig[0].length) };
}

// A messaging mock that never resolves: MenuRoute and ActionsMenu are
// pure nav surfaces, so nothing here needs host data to render.
const messaging = {
    listWallets: vi.fn(() => new Promise(() => {})),
    getSettings: vi.fn(() => new Promise(() => {})),
};

function mount(node, shell) {
    return render(
        React.createElement(MessagingProvider, { shell, messaging }, node),
    );
}

afterEach(() => cleanup());

describe('Home declares no dead props', () => {
    it('reads every prop it destructures', () => {
        const { names, body } = homePropBindings(homeSource);
        // Sanity: the parse found a real signature, not an empty match.
        expect(names.length).toBeGreaterThan(10);
        const dead = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(body));
        expect(dead).toEqual([]);
    });

    it('no longer accepts or documents extraActions', () => {
        // Belt-and-braces on the specific prop from the report: a
        // re-added `extraActions` that IS rendered would pass the guard
        // above, but the entries belong in ActionsMenu, not Home.
        expect(homeSource).not.toMatch(/@param.*extraActions/);
    });
});

describe('small mode can still reach the §40 action entries', () => {
    it('offers "More actions" in the pancake menu', async () => {
        const onMoreActions = vi.fn();
        mount(
            React.createElement(MenuRoute, { onBack: () => {}, onMoreActions }),
            'popup',
        );
        const row = screen.getByRole('button', { name: /more actions/i });
        row.click();
        expect(onMoreActions).toHaveBeenCalledTimes(1);
    });

    it('renders every ActionsMenu entry in the small variant', () => {
        const entries = [
            { id: 'issue', label: 'Issue token', onSelect: vi.fn() },
            { id: 'mint', label: 'Mint', onSelect: vi.fn() },
            { id: 'airdrop', label: 'Airdrop tokens', onSelect: vi.fn() },
        ];
        mount(
            React.createElement(ActionsMenu, { entries, onBack: () => {} }),
            'popup',
        );
        for (const e of entries) {
            expect(screen.getByRole('button', { name: new RegExp(e.label, 'i') })).toBeTruthy();
        }
    });
});
