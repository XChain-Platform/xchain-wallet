// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G126 (operator 2026-11-15): at phone and popup widths a form page has no
// card around the whole form; at iPad and desktop widths the form sits in one
// card at the standard form column width, centred (revision 2026-11-15). Settings' form pages (Automatic Donations and the Backup and
// Recovery forms) and a coin's fee page take the form frame; the Network page
// draws no outer card at any width. jsdom cannot evaluate media queries, so the
// frame mode is read from the surface and the CSS rule is read as text; the
// headless run at 360, 411 and 1280 is the rendered proof.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const SETTINGS = {
    ...createDefaultSettings(),
    activeNetwork: 'mainnet',
    fees: { 'bitcoin-mainnet': { strategy: 'normal', rbfByDefault: true, customSatsPerKb: null } },
};

function pending() {
    return new Promise(() => {});
}

function settingsMessaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderPage(id) {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: settingsMessaging() }}>
            <Settings
                onBack={() => {}}
                activeWallet={{ id: 'wallet-1', name: 'Primary Wallet' }}
                activeAccount={{ id: 'account-1', name: 'Daily', index: 0 }}
                onOpenWalletPicker={() => {}}
                onOpenAccountPicker={() => {}}
                initialSubpageId={id}
            />
        </MessagingContext.Provider>,
    );
}

const surfaceOf = (container) => container.querySelector('[data-settings-section]');

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Settings form frame (G126)', () => {
    it('frames Automatic Donations as a form page: no inline flat style, the form frame mode', async () => {
        const { container } = renderPage('ads');
        await screen.findByRole('heading', { level: 1, name: 'Automatic Donations' });
        await waitFor(() => expect(container.querySelector('[data-testid="ads-page"]')).not.toBeNull());
        const surface = surfaceOf(container);
        expect(surface.getAttribute('data-settings-section')).toBe('ads');
        expect(surface.getAttribute('data-settings-frame')).toBe('form');
        // Wide widths keep the card: nothing strips it inline.
        expect(surface.style.border).toBe('');
        expect(surface.style.background).toBe('');
    });

    it.each(['backup-export', 'backup-phrase', 'backup-test', 'backup-publish', 'backup-restore', 'backup-contacts-export'])(
        '%s follows the same form frame',
        async (id) => {
            const { container } = renderPage(id);
            await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe(id));
            expect(surfaceOf(container).getAttribute('data-settings-frame')).toBe('form');
            expect(surfaceOf(container).style.padding).toBe('');
        },
    );

    it('frames a coin fee page like Automatic Donations', async () => {
        const { container } = renderPage('fees-network:bitcoin-mainnet');
        await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe('fees-network:bitcoin-mainnet'));
        const surface = surfaceOf(container);
        expect(surface.getAttribute('data-settings-frame')).toBe('form');
        expect(surface.style.border).toBe('');
        expect(surface.style.background).toBe('');
    });

    it.each([
        ['notifications-quiet', 'Quiet Hours'],
        ['notifications-sounds', 'Notification Sounds'],
        ['security-panic', 'Panic Mode'],
    ])('%s is a form page in the shared frame (operator 2026-11-15)', async (id, title) => {
        const { container } = renderPage(id);
        await screen.findByRole('heading', { level: 1, name: title });
        await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe(id));
        const surface = surfaceOf(container);
        expect(surface.getAttribute('data-settings-frame')).toBe('form');
        expect(surface.style.border).toBe('');
        expect(surface.style.background).toBe('');
    });

    it.each([
        ['security-password', 'Wallet Password'],
        ['security-duress', 'Duress Passphrase'],
        ['security-biometric-enable', 'Enable Biometric Unlock'],
        ['display-tokens-add', 'Add Watched Token'],
        ['display-lists', 'Clear Remembered Network Filters'],
        ['display-reset', 'Reset Display Settings'],
        ['privacy-reset', 'Reset Privacy Settings'],
        ['wallet-remove', 'Remove Wallet'],
        ['wallet-xpub', 'Extended Public Keys'],
        ['display-number-format', 'Number Format'],
        ['display-balances', 'Hide Small Balances'],
    ])('%s uses the shared form frame', async (id, title) => {
        const { container } = renderPage(id);
        await screen.findByRole('heading', { level: 1, name: title });
        await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe(id));
        expect(surfaceOf(container).getAttribute('data-settings-frame')).toBe('form');
    });

    it('lists the sounds on a flat Choose Sound page with no card around its list card', async () => {
        const { container } = renderPage('notifications-sound:governancePolls');
        await screen.findByRole('heading', { level: 1, name: 'Choose Sound' });
        const surface = surfaceOf(container);
        expect(surface.getAttribute('data-settings-frame')).toBe('flat');
    });

    it('draws the Network page with no outer card at any width', async () => {
        const { container } = renderPage('network-active');
        await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe('network-active'));
        const surface = surfaceOf(container);
        expect(surface.getAttribute('data-settings-frame')).toBe('flat');
        expect(surface.style.background).toBe('transparent');
        expect(surface.style.padding).toMatch(/^0(px)?$/);
    });

    it('keeps the card on other Settings pages', async () => {
        const { container } = renderPage('keyboard');
        await waitFor(() => expect(surfaceOf(container)?.getAttribute('data-settings-section')).toBe('keyboard'));
        expect(surfaceOf(container).getAttribute('data-settings-frame')).toBe('card');
    });
});

describe('Settings form frame stylesheet', () => {
    const css = readFileSync(
        join(process.cwd(), 'packages/core/src/shared/routes/Settings.module.css'),
        'utf8',
    );

    it('drops the outer card only below 600px, the Form Standard breakpoint', () => {
        const block = css.match(/@media not all and \(min-width: 600px\) \{\s*\.settingsSurface\.formFrame \{([^}]*)\}/);
        expect(block, 'narrow form-frame rule').not.toBeNull();
        const body = block[1];
        expect(body).toMatch(/padding:\s*0;/);
        expect(body).toMatch(/background:\s*transparent;/);
        expect(body).toMatch(/border:\s*0;/);
        expect(body).toMatch(/border-radius:\s*0;/);
        expect(body).toMatch(/box-shadow:\s*none;/);
        expect(css).toMatch(/\.settingsSurface\.settingsSurface\.settingsSurface\.formFrame > \*\s*\{[^}]*padding-block-start:\s*0;/s);
        // The card is removed only there: the other .formFrame rule (the wide
        // width) never strips the card.
        expect(css.match(/\.formFrame/g)).toHaveLength(3);
        const others = css.split(block[0]).join('');
        expect(others).not.toMatch(/\.formFrame[^{]*\{[^}]*(background:\s*transparent|border:\s*0)/);
    });

    it('keeps Automatic Donations at the standard narrow header gap', () => {
        const ads = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/settings/AdsSection.module.css'),
            'utf8',
        );
        expect(ads).toMatch(/\.heroNotice\s*\{[^}]*margin-block:\s*0;/s);
    });

    it('sets the wide card to the standard form column width, centred (G126 revision 2026-11-15)', () => {
        const wide = css.match(/@media \(min-width: 600px\) \{\s*\.settingsSurface\.formFrame \{([^}]*)\}/);
        expect(wide, 'wide form-frame rule').not.toBeNull();
        // FormPage's wide card width token, never the full page width.
        expect(wide[1]).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        expect(wide[1]).toMatch(/margin-inline:\s*auto;/);
        expect(wide[1]).toMatch(/width:\s*100%;/);
        const formPage = readFileSync(join(process.cwd(), 'packages/core/src/ui/FormPage.module.css'), 'utf8');
        expect(formPage).toMatch(/max-width:\s*var\(--xc-form-card-max-width\);/);
        const tokens = readFileSync(join(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');
        expect(tokens).toMatch(/--xc-form-card-max-width:\s*560px;/);
    });


    it('matches FormPage, which draws its one card from 600px (U03)', () => {
        const formPage = readFileSync(
            join(process.cwd(), 'packages/core/src/ui/FormPage.module.css'),
            'utf8',
        );
        expect(formPage).toMatch(/@media \(min-width: 600px\)/);
    });
});
