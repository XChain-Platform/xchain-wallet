// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearDemoWalletId, clearLockoutState } from '../../../packages/core/src/flows/index.js';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Locked.module.css'),
    'utf8',
);

const VIEWPORTS = [
    { name: 'small phone portrait', width: 320, height: 568 },
    { name: 'large phone portrait', width: 412, height: 732 },
    { name: 'phone landscape', width: 732, height: 412 },
];

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    clearLockoutState();
    document.documentElement.removeAttribute('data-xc-keyboard');
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
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging: { unlockWallet: vi.fn() } },
        React.createElement(Locked, { onUnlocked: vi.fn() }),
    ));
}

describe('Locked compact-height layout', () => {
    it('removes decorative height and tightens secondary content on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) \{[\s\S]*?\.hero\s*\{[\s\S]*?flex-direction: row;[\s\S]*?\.logo\s*\{[\s\S]*?width: 40px;[\s\S]*?\.lockoutBanner\s*\{[\s\S]*?padding: var\(--xc-space-2\);[\s\S]*?\.forgotBlock\s*\{[\s\S]*?margin-top: var\(--xc-space-2\);[\s\S]*?\n\}/,
        );
        expect(css).not.toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) \{\s*@media[^\{]*min-width: 600px/,
        );
        expect(css).not.toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) \{[\s\S]*?\.unlockingNote\s*\{[\s\S]*?display: none;/,
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
        expect(css).toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\) \.lockoutBanner\s*\{[\s\S]*padding: var\(--xc-space-2\);/,
        );
        expect(css).not.toMatch(
            /:global\(html\[data-xc-keyboard='open'\]\)[^\{]*(?:\.hero|\.forgotBlock)[^\{]*\{\s*display: none;/,
        );
    });

    it.each(VIEWPORTS)('renders every lock-screen control at $width x $height ($name)', (viewport) => {
        renderLocked(viewport);

        expect(screen.getByRole('heading', { name: 'Unlock wallet' })).toBeVisible();
        expect(screen.getByLabelText('Password')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
    });
});
