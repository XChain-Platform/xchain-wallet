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
import { render, screen, act, fireEvent } from '@testing-library/react';
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
import { BalanceList, isSmallBalanceRow, smallBalanceKeys } from '../../../packages/core/src/shared/components/BalanceList.jsx';

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

    it('keeps native and browser chrome in contrast with live theme changes', () => {
        const themeColor = document.createElement('meta');
        themeColor.setAttribute('name', 'theme-color');
        document.head.append(themeColor);
        const setStyle = vi.fn(() => Promise.resolve());
        globalThis.Capacitor = { Plugins: { SystemBars: { setStyle } } };

        try {
            applySettingsRootAttributes({ theme: 'dark' });
            expect(themeColor.getAttribute('content')).toBe('#0B0F17');
            expect(setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });

            applySettingsRootAttributes({ theme: 'light' });
            expect(themeColor.getAttribute('content')).toBe('#FFFFFF');
            expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
        } finally {
            themeColor.remove();
            delete globalThis.Capacitor;
        }
    });

    it.each([
        [true, '#0B0F17', 'DARK'],
        [false, '#FFFFFF', 'LIGHT'],
    ])('follows the OS theme for native chrome when dark mode is %s', (matches, color, style) => {
        const themeColor = document.createElement('meta');
        themeColor.setAttribute('name', 'theme-color');
        document.head.append(themeColor);
        const setStyle = vi.fn(() => Promise.resolve());
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches })));
        globalThis.Capacitor = { Plugins: { SystemBars: { setStyle } } };

        try {
            applySettingsRootAttributes({ theme: 'system' });
            expect(themeColor.getAttribute('content')).toBe(color);
            expect(setStyle).toHaveBeenLastCalledWith({ style });
        } finally {
            vi.unstubAllGlobals();
            themeColor.remove();
            delete globalThis.Capacitor;
        }
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

    it.each([
        ['action', 'Bitcoin', 'the Bitcoin network'],
        ['message', undefined, 'without moving coins'],
        ['psbt', undefined, 'another app'],
    ])('renders one short %s sentence and links to live docs', (variant, chainLabel, expected) => {
        applySettingsRootAttributes({ learnMode: true });
        render(<LearnNote variant={variant} chainLabel={chainLabel} />);
        const note = screen.getByTestId('learn-note');
        // The Notice Standard: an info Notice (bold title, then the help
        // sentence), static page content, so not a live region.
        const body = note.querySelector('[data-learn-note-body]');
        expect(note).toHaveAttribute('data-tone', 'info');
        expect(note).not.toHaveAttribute('role');
        expect(note.querySelector('[data-notice-dismiss]')).toHaveAccessibleName('Dismiss learn note');
        expect(body.textContent.match(/[.!?](?=\s|$)/g)).toHaveLength(1);
        expect(note.textContent).toContain(expected);
        const learnMore = screen.getByRole('link', { name: 'Learn more' });
        expect(learnMore).toHaveAttribute(
            'href',
            'https://docs.xchain.io/components/wallet/security#sign-screen-safety-rails',
        );
        expect(learnMore).toHaveAttribute('target', '_blank');
        expect(learnMore).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('keeps each dismissed confirmation note hidden after remounting', () => {
        applySettingsRootAttributes({ learnMode: true });
        const view = render(<LearnNote variant="action" chainLabel="Bitcoin" />);

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss learn note' }));
        expect(screen.queryByTestId('learn-note')).toBeNull();

        view.unmount();
        render(<LearnNote variant="action" chainLabel="Bitcoin" />);
        expect(screen.queryByTestId('learn-note')).toBeNull();

        render(<LearnNote variant="message" />);
        expect(screen.getByTestId('learn-note')).toBeInTheDocument();
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
    // The rule judges value in the display currency (operator ruling 2026-11-14).
    const nativeRow = (chainId, quantity, fiatRate = null) => ({
        chainId, tick: 'X', kind: 'native', quantity, divisibility: 8, fiatRate,
    });
    const tokenRow = (quantity, divisibility = 8, fiatRate = null) => ({
        chainId: 'bitcoin-mainnet', tick: 'SPAM', kind: 'token', quantity, divisibility, fiatRate,
    });

    it('treats an empty coin row as small, the case the user actually hits', () => {
        // The reported symptom: LTC and DOGE listed at 0.00000000 with
        // "Hide small balances" ON. Zero is small even with no price.
        expect(isSmallBalanceRow(nativeRow('litecoin-mainnet', '0'))).toBe(true);
        expect(isSmallBalanceRow(nativeRow('dogecoin-mainnet', '0'))).toBe(true);
    });

    it('folds a row worth less than the amount and keeps one worth the amount or more', () => {
        // 0.00001 BTC at 90,000 is 0.90; 0.0000112 BTC is 1.008.
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '1000', 90000), '1')).toBe(true);
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '1120', 90000), '1')).toBe(false);
        // Exactly the amount is not under it.
        expect(isSmallBalanceRow(tokenRow('100000000', 8, 1), '1')).toBe(false);
        expect(isSmallBalanceRow(tokenRow('99999999', 8, 1), '1')).toBe(true);
    });

    it('judges every divisibility by value, an indivisible token included', () => {
        expect(isSmallBalanceRow(tokenRow('1', 0, 0.5), '1')).toBe(true);
        expect(isSmallBalanceRow(tokenRow('1', 0, 650), '1')).toBe(false);
        expect(isSmallBalanceRow(tokenRow('9', 3, 100), '1')).toBe(true);
        expect(isSmallBalanceRow(tokenRow('10', 3, 100), '1')).toBe(false);
    });

    it('never calls a row with no price small by value', () => {
        // Hide unknown tokens governs these; a tiny unpriced balance stays listed.
        expect(isSmallBalanceRow(tokenRow('1'))).toBe(false);
        expect(isSmallBalanceRow(nativeRow('bitcoin-mainnet', '1'))).toBe(false);
        // Home's token lists draw an unpriced token with a zero rate.
        expect(isSmallBalanceRow(tokenRow('1', 8, 0))).toBe(false);
        expect(isSmallBalanceRow(tokenRow('1', 8, Number.NaN))).toBe(false);
    });

    it('keeps pending, escrowed and unread rows listed however little they are worth', () => {
        expect(isSmallBalanceRow({ ...tokenRow('1', 8, 1), escrowed: true }, '1')).toBe(false);
        expect(isSmallBalanceRow({ ...nativeRow('bitcoin-mainnet', '1', 90000), pendingQuantity: '5' }, '1')).toBe(false);
        expect(isSmallBalanceRow({ ...nativeRow('bitcoin-mainnet', '0', 90000), unavailable: 'all' }, '1')).toBe(false);
    });

    it('lists the small keys less the pinned ones', () => {
        const rows = [
            { ...tokenRow('1', 8, 1), tick: 'A' },
            { ...tokenRow('1', 8, 1), tick: 'B' },
            { ...tokenRow('100000000000', 8, 1), tick: 'C' },
        ];
        expect([...smallBalanceKeys(rows, '1', new Set(['bitcoin-mainnet:B']))]).toEqual(['bitcoin-mainnet:A']);
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

    it('applies the selected amount and number format to rendered rows', () => {
        render(
            <BalanceList
                rows={[
                    { chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native', displayName: 'Bitcoin', quantity: '123450000000', divisibility: 8, fiatRate: null },
                    // 0.00999999 LTC at 90 is about 0.90, under 5.
                    { chainId: 'litecoin-mainnet', tick: 'LTC', kind: 'native', displayName: 'Litecoin', quantity: '999999', divisibility: 8, fiatRate: 90 },
                ]}
                hideSmallBalances
                smallBalanceFiat="5"
                numberFormat="trim"
            />,
        );
        expect(screen.getByText('1,234.5')).toBeTruthy();
        expect(screen.queryByText('Litecoin')).toBeNull();
        expect(screen.getByTestId('small-balances-toggle').textContent).toBe('Show 1 small balance');
    });
});
