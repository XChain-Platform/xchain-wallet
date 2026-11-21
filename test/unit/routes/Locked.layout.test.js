// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import { clearDemoWalletId, clearLockoutState, markDemoWallet } from '../../../packages/core/src/flows/index.js';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Locked.module.css'),
    'utf8',
);
const loadingCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Loading.module.css'),
    'utf8',
);
const bootLogoCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/BootLogo.module.css'),
    'utf8',
);

const VIEWPORTS = [
    { name: 'small phone portrait', width: 320, height: 568 },
    { name: 'reported phone portrait', width: 360, height: 640 },
    { name: 'large phone portrait', width: 412, height: 732 },
    { name: 'phone landscape', width: 732, height: 412 },
];

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    clearLockoutState();
    document.documentElement.removeAttribute('data-xc-keyboard');
    vi.restoreAllMocks();
});

function renderLocked({ width, height }) {
    Object.defineProperties(window, {
        innerWidth: { configurable: true, value: width },
        innerHeight: { configurable: true, value: height },
        visualViewport: {
            configurable: true,
            value: { width, height: Math.round(height * 0.55), scale: 1 },
        },
    });
    document.documentElement.setAttribute('data-xc-keyboard', 'open');
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging: { unlockWallet: vi.fn() } },
        React.createElement(Locked, { onUnlocked: vi.fn() }),
    ));
}

describe('Locked compact-height layout', () => {
    it('removes decorative height and tightens secondary content on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 7\/5\) \{[\s\S]*?\.hero\s*\{[\s\S]*?flex-direction: row;[\s\S]*?\.logo\s*\{[\s\S]*?width: 40px;[\s\S]*?\.forgotBlock\s*\{[\s\S]*?margin-top: var\(--xc-space-2\);[\s\S]*?\n\}/,
        );
        expect(css).not.toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 7\/5\) \{\s*@media[^\{]*min-width: 600px/,
        );
        expect(css).not.toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 7\/5\) \{[\s\S]*?\.unlockingNote\s*\{[\s\S]*?display: none;/,
        );
    });

    it('keeps keyboard-open space for the password feedback and unlock action', () => {
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.unlockForm > :first-child\s*\{\s*display: contents;/,
        );
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.unlockForm > :last-child\s*\{\s*order: 2;/,
        );
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.forgotBlock,[\s\S]*?\.demoExitBlock\s*\{[\s\S]*?order: 3;/,
        );
        expect(css).not.toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\)[^\{]*(?:\.hero|\.forgotBlock)[^\{]*\{\s*display: none;/,
        );
    });

    it.each(VIEWPORTS)('renders every lock-screen control at $width x $height ($name)', (viewport) => {
        const { container } = renderLocked(viewport);

        // The product name remains the h1 for assistive technology, but the
        // enlarged logo is the only visible brand on the lock screen.
        const brandHeading = screen.getByRole('heading', {
            level: 1,
            name: branding.PRODUCT_NAME,
            hidden: true,
        });
        expect(brandHeading).toHaveClass('sr-only');
        expect(brandHeading.parentElement.querySelector('h1:not(.sr-only)')).toBeNull();
        expect(container.querySelector('[data-locked-logo]')).toBeVisible();
        expect(screen.getByLabelText('Password')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Forgot Password?' })).toBeVisible();
    });

    it('uses the Loading logo size on Locked through one shared class', () => {
        const logoRule = css.match(/\.logo\s*\{([^}]*)\}/)?.[1];
        const loadingLogoRule = loadingCss.match(/\.bootLogo\s*\{([^}]*)\}/)?.[1];
        const sharedSize = bootLogoCss.match(/\.standardSize\s*\{([^}]*)\}/)?.[1];

        expect(logoRule).toMatch(/composes: standardSize from '\.\/BootLogo\.module\.css';/);
        expect(loadingLogoRule).toMatch(/composes: standardSize from '\.\/BootLogo\.module\.css';/);
        expect(sharedSize).toMatch(/width: 152px;/);
        expect(sharedSize).toMatch(/height: 94px;/);
        expect(logoRule).toMatch(/margin-bottom: 0;/);
        expect(css).not.toMatch(/width: (?:144|180)px;/);
    });

    it('orders the primary action before recovery and toggles password visibility in memory', () => {
        renderLocked({ width: 360, height: 640 });
        const password = screen.getByLabelText('Password');
        const unlock = screen.getByRole('button', { name: 'Unlock Wallet' });
        const forgot = screen.getByRole('button', { name: 'Forgot Password?' });
        const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
        const consoleWrites = ['log', 'info', 'warn', 'error', 'debug']
            .map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

        expect(password.compareDocumentPosition(unlock) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(unlock.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();

        fireEvent.change(password, { target: { value: 'not-persisted' } });
        const show = screen.getByRole('button', { name: 'Show password' });
        expect(password).toHaveAttribute('type', 'password');
        fireEvent.click(show);
        expect(password).toHaveAttribute('type', 'text');
        expect(password).toHaveValue('not-persisted');
        expect(screen.getByRole('button', { name: 'Hide password' }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(storageWrite).not.toHaveBeenCalled();
        for (const write of consoleWrites) expect(write).not.toHaveBeenCalled();

        const forgotRule = css.match(/\.forgotBlock\s*\{([^}]*)\}/);
        expect(forgotRule?.[1]).not.toMatch(/border/);
    });

    it('spaces every column in the unlock stack by the 8px gap alone', () => {
        for (const name of ['unlockActions', 'demoExitBlock', 'forgotBlock', 'wipeConfirm', 'passwordField']) {
            const rule = css.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`));
            expect(rule?.[1], name).toMatch(/gap: var\(--xc-space-2\);/);
            expect(rule?.[1], name).not.toMatch(/margin|padding|border/);
        }
        // The shared notice row's own 8px margin must not stack on the gap.
        expect(css).toMatch(
            /\.unlockActions \[data-variant\],[\s\S]*?\.demoExitBlock > \[data-variant\],[\s\S]*?\.wipeConfirm > \[data-variant\],[\s\S]*?\.passwordField > \[data-variant\]\s*\{\s*margin: 0;/,
        );
        expect(css).not.toMatch(/\.demoExitNote/);
    });

    it('shows the demo wallet line as the info notice above the password field', () => {
        markDemoWallet('demo-1', { password: 'throwaway' });
        renderLocked({ width: 360, height: 640 });
        const notice = screen.getByText('This is a demo wallet.').closest('[data-variant]');
        expect(notice).toHaveAttribute('data-variant', 'info');
        // The Notice Standard's info icon (an SVG circle i, 2026-11-15).
        expect(notice.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(notice.compareDocumentPosition(screen.getByLabelText('Password')) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(notice.parentElement.className).toMatch(/passwordField/);
        expect(screen.getByRole('button', { name: /exit demo/i })).toBeVisible();
    });
});

describe('Locked Forgot Password page', () => {
    function renderPlain() {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: { unlockWallet: vi.fn() } },
            React.createElement(Locked, { onUnlocked: vi.fn() }),
        ));
    }

    it('offers Forgot Password as a full-width secondary button with a non-lock icon', () => {
        renderPlain();
        const forgot = screen.getByRole('button', { name: 'Forgot Password?' });
        const unlock = screen.getByRole('button', { name: 'Unlock Wallet' });
        expect(forgot).toBeVisible();
        expect(forgot).not.toHaveAttribute('aria-expanded');
        expect(forgot.getAttribute('data-variant') || forgot.className).toMatch(/secondary/);
        const lockIcon = render(React.createElement(Icon.LockIcon)).container.innerHTML;
        const forgotSvg = forgot.querySelector('svg');
        expect(forgotSvg).not.toBeNull();
        expect(forgotSvg.outerHTML).not.toBe(lockIcon);
        expect(forgotSvg.outerHTML).toBe(
            render(React.createElement(Icon.InfoIcon)).container.innerHTML,
        );
        expect(unlock.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Nothing of the page shows on the lock screen.
        expect(screen.queryByText('Reset with Recovery Phrase')).toBeNull();
        expect(screen.queryByText('Erase Everything')).toBeNull();
    });

    // Operator ruling 2026-11-16: the page lists phrase reset (when a wrap
    // exists), backup restore, then erase, each a row with a one-line description.
    function renderWithStatus(phraseReset) {
        render(React.createElement(
            MessagingProvider,
            {
                shell: 'web',
                messaging: {
                    unlockWallet: vi.fn(),
                    recoveryStatus: vi.fn().mockResolvedValue({ hasWallet: true, phraseReset }),
                },
            },
            React.createElement(Locked, { onUnlocked: vi.fn() }),
        ));
    }

    it('shows the notice in a bubble and each choice row with a title and a one-line description', async () => {
        renderWithStatus(true);
        fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
        await screen.findByRole('list', { name: 'Ways back into your wallet' });

        const notice = screen.getByText(/Choose how to get back into your wallet/).closest('[data-variant]');
        expect(notice).not.toBeNull();
        for (const [name, description] of [
            ['Reset with Recovery Phrase', 'Type the recovery phrase of any wallet on this device and choose a new password. Nothing is erased.'],
            ['Restore from Backup File', 'A backup from this wallet can restore now. A different wallet waits 48 hours.'],
            ['Erase Everything', 'Erase every wallet on this device after a 48-hour wait.'],
        ]) {
            const row = screen.getByRole('button', { name: new RegExp(`^${name}`) });
            expect(row).toHaveTextContent(name);
            expect(row).toHaveTextContent(description);
            expect(row.querySelector('svg')).not.toBeNull();
        }
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('opens a page with the line, the choices as rows in one list, and no Cancel; Back returns', async () => {
        renderPlain();
        fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));

        expect(screen.getByRole('heading', { level: 1, name: 'Forgot Password?' })).toBeInTheDocument();
        const backup = await screen.findByRole('button', { name: /^Restore from Backup File/ });
        const erase = screen.getByRole('button', { name: /^Erase Everything/ });
        expect(backup.closest('ul')).toBe(erase.closest('ul'));
        // A shell with no recovery lane offers no phrase reset.
        expect(screen.queryByRole('button', { name: /^Reset with Recovery Phrase/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
        // The lock screen is gone while the page shows.
        expect(screen.queryByLabelText('Password')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByLabelText('Password')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Forgot Password?' })).toBeVisible();
    });

    it('keeps each way back on its own page, with Back stepping to the choices', async () => {
        renderWithStatus(true);
        fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Erase Everything/ }));

        expect(screen.getByRole('heading', { level: 1, name: 'Erase Everything' })).toBeInTheDocument();
        const schedule = screen.getByRole('button', { name: 'Schedule Erase' });
        expect(schedule).toBeEnabled();
        expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Reset with Recovery Phrase/ }));
        expect(screen.getByRole('heading', { level: 1, name: 'Reset Password' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reset Password' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
        expect(await screen.findByRole('button', { name: /^Restore from Backup File/ })).toBeVisible();
    });
});
