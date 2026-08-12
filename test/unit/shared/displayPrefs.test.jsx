// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// regression. Theme, Reduced motion, Hide small balances and Learn
// Mode all persisted, validated and appeared in the diagnostic dump while
// NOTHING read them: Theme=Light survived a reload with the body still at
// rgb(11, 15, 23), Reduced motion=Always left --xc-transition at 160ms, and
// Hide small balances=ON still listed LTC and DOGE at 0.00000000.
//
// The read side is a set of attributes on <html> plus the consumers that key
// off them. These tests pin the projection (settings in, attributes out),
// the reduced-motion resolution order (in-app override beats the OS), the
// dust rule, and the Learn Mode copy appearing only when asked for.

import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
    applySettingsRootAttributes,
    cacheDisplayPrefs,
    readCachedDisplayPrefs,
    THEME_ATTR,
    LEARN_MODE_ATTR,
} from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';
import {
    resolveReducedMotion,
    REDUCED_MOTION_ATTR,
} from '../../../packages/core/src/ui/reducedMotion.js';
import { LearnNote } from '../../../packages/core/src/shared/components/LearnNote.jsx';
import { BalanceList, isSmallBalanceRow } from '../../../packages/core/src/shared/components/BalanceList.jsx';

const root = () => document.documentElement;

/** The wallet workspace root, whichever directory vitest was invoked from. */
const WORKSPACE_ROOT = existsSync(resolve(process.cwd(), 'packages/core/src/ui/tokens.css'))
    ? process.cwd()
    : resolve(process.cwd(), 'xchain-wallet');

function mockOsReducedMotion(matches) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
}

beforeEach(() => {
    root().removeAttribute(THEME_ATTR);
    root().removeAttribute(REDUCED_MOTION_ATTR);
    root().removeAttribute(LEARN_MODE_ATTR);
    globalThis.localStorage?.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('settings -> root attributes', () => {
    it('stamps an explicit theme and clears it again for System default', () => {
        applySettingsRootAttributes({ theme: 'light' });
        expect(root().getAttribute(THEME_ATTR)).toBe('light');

        applySettingsRootAttributes({ theme: 'dark' });
        expect(root().getAttribute(THEME_ATTR)).toBe('dark');

        // 'system' means "follow the OS", which is the ABSENCE of the
        // attribute: tokens.css keys the OS palette off :not([data-xc-theme]).
        applySettingsRootAttributes({ theme: 'system' });
        expect(root().hasAttribute(THEME_ATTR)).toBe(false);
    });

    it('maps the reduced-motion vocabulary onto the CSS one', () => {
        applySettingsRootAttributes({ reducedMotion: 'always' });
        expect(root().getAttribute(REDUCED_MOTION_ATTR)).toBe('reduce');

        applySettingsRootAttributes({ reducedMotion: 'never' });
        expect(root().getAttribute(REDUCED_MOTION_ATTR)).toBe('no-preference');

        applySettingsRootAttributes({ reducedMotion: 'auto' });
        expect(root().hasAttribute(REDUCED_MOTION_ATTR)).toBe(false);
    });

    it('stamps learn mode only when it is on', () => {
        applySettingsRootAttributes({ learnMode: true });
        expect(root().getAttribute(LEARN_MODE_ATTR)).toBe('on');
        applySettingsRootAttributes({ learnMode: false });
        expect(root().hasAttribute(LEARN_MODE_ATTR)).toBe(false);
    });

    it('mirrors the preferences so the locked screen can paint them', () => {
        cacheDisplayPrefs({ theme: 'dark', reducedMotion: 'always', learnMode: true });
        // Settings live in the encrypted vault, so on a cold load there is
        // nothing to read until unlock; the mirror is what stops the lock
        // screen painting in the OS theme and then snapping.
        applySettingsRootAttributes(readCachedDisplayPrefs());
        expect(root().getAttribute(THEME_ATTR)).toBe('dark');
        expect(root().getAttribute(REDUCED_MOTION_ATTR)).toBe('reduce');
        expect(root().getAttribute(LEARN_MODE_ATTR)).toBe('on');
    });

    it('holds no wallet data in the mirror', () => {
        cacheDisplayPrefs({ theme: 'dark', reducedMotion: 'auto', learnMode: false, seed: 'nope' });
        expect(Object.keys(readCachedDisplayPrefs()).sort())
            .toEqual(['learnMode', 'reducedMotion', 'theme']);
    });
});

describe('reduced motion resolution', () => {
    it('follows the OS when the user has not overridden it', () => {
        mockOsReducedMotion(true);
        expect(resolveReducedMotion()).toBe(true);
        mockOsReducedMotion(false);
        expect(resolveReducedMotion()).toBe(false);
    });

    it('"Always reduce" wins on an OS that does not advertise the preference', () => {
        // The whole point of the setting: this user's OS says no-preference,
        // which is exactly why they reached for the in-app control.
        mockOsReducedMotion(false);
        applySettingsRootAttributes({ reducedMotion: 'always' });
        expect(resolveReducedMotion()).toBe(true);
    });

    it('"Never reduce" ignores an OS that does advertise it', () => {
        mockOsReducedMotion(true);
        applySettingsRootAttributes({ reducedMotion: 'never' });
        expect(resolveReducedMotion()).toBe(false);
    });
});

describe('LearnNote', () => {
    it('renders nothing while Learn Mode is off', () => {
        render(<LearnNote variant="action" chainLabel="Bitcoin" />);
        expect(screen.queryByTestId('learn-note')).toBeNull();
    });

    it('renders explanatory copy naming the chain when Learn Mode is on', () => {
        applySettingsRootAttributes({ learnMode: true });
        render(<LearnNote variant="action" chainLabel="Bitcoin" />);
        const note = screen.getByTestId('learn-note');
        expect(note.textContent).toContain('nothing has been sent yet');
        expect(note.textContent).toContain('the Bitcoin network');
    });

    it('explains a message signature differently from a payment', () => {
        applySettingsRootAttributes({ learnMode: true });
        render(<LearnNote variant="message" />);
        expect(screen.getByTestId('learn-note').textContent).toContain('moves no coins');
    });

    it('picks the live setting up without a remount', async () => {
        render(<LearnNote variant="action" chainLabel="Bitcoin" />);
        expect(screen.queryByTestId('learn-note')).toBeNull();
        await act(async () => {
            applySettingsRootAttributes({ learnMode: true });
            // MutationObserver callbacks are delivered as microtasks.
            await Promise.resolve();
        });
        expect(screen.queryByTestId('learn-note')).not.toBeNull();
    });
});

describe('tokens.css theme + motion switches', () => {
    // Vite rewrites import.meta.url to an http URL under the jsdom
    // environment, so anchor on the workspace root instead.
    const css = readFileSync(resolve(WORKSPACE_ROOT, 'packages/core/src/ui/tokens.css'), 'utf8');

    /** Custom-property declarations of every block opened by `selector`. */
    function blocksFor(selector) {
        const out = [];
        let from = 0;
        for (;;) {
            const at = css.indexOf(selector, from);
            if (at < 0) break;
            const open = css.indexOf('{', at);
            const close = css.indexOf('}', open);
            const decls = css.slice(open + 1, close)
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.startsWith('--'))
                .sort();
            if (decls.length > 0) out.push(decls);
            from = close;
        }
        return out;
    }

    it('lets an explicit Light choice escape the OS dark palette', () => {
        // Without the :not() guard the media query re-applies dark over the
        // attribute rule, which is the "Theme=Light did nothing" symptom.
        expect(css).toContain(':root:not([data-xc-theme="light"])');
    });

    it('keeps the attribute-driven dark palette in sync with the media one', () => {
        const viaMedia = blocksFor(':root:not([data-xc-theme="light"])');
        const viaAttr = blocksFor(':root[data-xc-theme="dark"]');
        expect(viaMedia.length).toBeGreaterThan(0);
        expect(viaAttr).toEqual(viaMedia);
    });

    it('collapses motion for the forced case that CSS media queries cannot see', () => {
        expect(css).toContain(':root[data-xc-reduced-motion="reduce"]');
        expect(css).toContain(':root:not([data-xc-reduced-motion="no-preference"])');
        expect(css).toMatch(/:root\[data-xc-reduced-motion="reduce"\] \*/);
    });
});

describe('hide small balances', () => {
    const nativeRow = (chainId, quantity) => ({
        chainId, tick: 'X', kind: 'native', quantity, divisibility: 8,
    });
    const tokenRow = (quantity, divisibility = 8) => ({
        chainId: 'bitcoin-mainnet', tick: 'SPAM', kind: 'token', quantity, divisibility,
    });

    it('treats an empty coin row as dust, the case the user actually hits', () => {
        // The reported symptom: LTC and DOGE listed at 0.00000000 with
        // "Hide small balances" ON.
        expect(isSmallBalanceRow(nativeRow('litecoin-mainnet', '0'))).toBe(true);
        expect(isSmallBalanceRow(nativeRow('dogecoin-mainnet', '0'))).toBe(true);
    });

    it('uses a per-chain threshold for non-empty coin rows', () => {
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '545'))).toBe(true);
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '546'))).toBe(false);
        expect(isSmallBalanceRow(nativeRow('dogecoin-mainnet', '999999'))).toBe(true);
        expect(isSmallBalanceRow(nativeRow('dogecoin-mainnet', '1000000'))).toBe(false);
    });

    it('keeps a real balance visible', () => {
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '100000000'))).toBe(false);
        expect(isSmallBalanceRow(tokenRow('100000000'))).toBe(false);
    });

    it('never calls an indivisible token dust, however small the count', () => {
        // One unit of an indivisible token is one whole thing, usually an NFT.
        expect(isSmallBalanceRow(tokenRow('1', 0))).toBe(false);
    });

    it('calls a sub-ten-thousandth of a divisible token dust', () => {
        expect(isSmallBalanceRow(tokenRow('9999'))).toBe(true);
        expect(isSmallBalanceRow(tokenRow('10000'))).toBe(false);
    });

    const listRows = [
        { chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native', displayName: 'Bitcoin', quantity: '250000', divisibility: 8, fiatRate: null },
        { chainId: 'litecoin-mainnet', tick: 'LTC', kind: 'native', displayName: 'Litecoin', quantity: '0', divisibility: 8, fiatRate: null },
        { chainId: 'dogecoin-mainnet', tick: 'DOGE', kind: 'native', displayName: 'Dogecoin', quantity: '0', divisibility: 8, fiatRate: null },
    ];

    it('lists every row when the setting is off', () => {
        render(<BalanceList rows={listRows} />);
        expect(screen.getByText('Litecoin')).toBeTruthy();
        expect(screen.queryByTestId('small-balances-toggle')).toBeNull();
    });

    it('collapses the empty coins behind a toggle when the setting is on', () => {
        render(<BalanceList rows={listRows} hideSmallBalances />);
        expect(screen.getByText('Bitcoin')).toBeTruthy();
        expect(screen.queryByText('Litecoin')).toBeNull();
        expect(screen.queryByText('Dogecoin')).toBeNull();
        // Collapsed, never dropped: a balance the wallet knows about but
        // refuses to show anywhere is a support ticket.
        const toggle = screen.getByTestId('small-balances-toggle');
        expect(toggle.textContent).toBe('Show 2 small balances');
        act(() => { toggle.click(); });
        expect(screen.getByText('Litecoin')).toBeTruthy();
    });

    it('leaves a pinned row alone even when it is dust', () => {
        render(
            <BalanceList
                rows={listRows}
                hideSmallBalances
                pinnedKeys={new Set(['litecoin-mainnet:LTC'])}
            />,
        );
        expect(screen.getByText('Litecoin')).toBeTruthy();
        expect(screen.getByTestId('small-balances-toggle').textContent).toBe('Show 1 small balance');
    });
});
