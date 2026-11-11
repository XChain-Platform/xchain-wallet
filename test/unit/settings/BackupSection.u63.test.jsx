// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

afterEach(() => cleanup());

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({
            'dogecoin-testnet': [{ id: 'a1', address: 'D9u63addr', source: 'hd' }],
        })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />
        </MessagingProvider>,
    );
}

function actionButtons() {
    return Array.from(document.querySelectorAll(`button.${buttonStyles.btn}`))
        .filter((b) => !b.getAttribute('aria-label')?.startsWith('About '));
}

function expectEveryButtonHasIcon() {
    const buttons = actionButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
        expect(b.querySelector('svg'), b.getAttribute('aria-label') || b.textContent).not.toBeNull();
    }
}

function expectOnlyGreen(name) {
    const green = actionButtons().filter((b) => b.classList.contains(buttonStyles.success));
    expect(green).toHaveLength(1);
    expect(green[0].textContent).toBe(name);
}

describe('BackupSection U57 and U63', () => {
    it('gives every row button an icon, including Test…', () => {
        mount();
        expect(screen.getByRole('button', { name: 'Test…' }).querySelector('svg')).not.toBeNull();
        expectEveryButtonHasIcon();
        expect(actionButtons().filter((b) => b.classList.contains(buttonStyles.success))).toHaveLength(0);
    });

    it('export form: green named submit, tips on both password fields', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expectOnlyGreen('Export backup');
        expectEveryButtonHasIcon();
        expect(screen.getAllByRole('button', { name: /^About .*password/i }).length).toBeGreaterThanOrEqual(2);
    });

    it('reveal form: green Reveal phrase and a password tip', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        expectOnlyGreen('Reveal phrase');
        expectEveryButtonHasIcon();
        expect(screen.getByRole('button', { name: /^About .*password/i })).toBeTruthy();
    });

    it('test form: green Run test and tips on phrase, format, addresses and passphrase', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        expectOnlyGreen('Run test');
        expectEveryButtonHasIcon();
        for (const name of [/phrase to test/i, /format/i, /addresses to check/i, /passphrase/i]) {
            expect(screen.getByRole('button', { name: new RegExp(`^About .*${name.source}`, 'i') })).toBeTruthy();
        }
    });

    it('publish form: green Publish labels and tips on network and password', async () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Publish now…' }));
        await screen.findByLabelText('Publish network');
        expectOnlyGreen('Publish labels');
        expectEveryButtonHasIcon();
        const tips = screen.getAllByRole('button', { name: /^About / });
        expect(tips.length).toBeGreaterThanOrEqual(2);
    });

    it('check form: green Check for contacts and tips on network and password', async () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Check…' }));
        await screen.findByLabelText('Restore network');
        expectOnlyGreen('Check for contacts');
        expectEveryButtonHasIcon();
        expect(screen.getAllByRole('button', { name: /^About / }).length).toBeGreaterThanOrEqual(2);
    });

    it('keeps a token gap around the row button so it never meets the divider', () => {
        const css = readFileSync('packages/core/src/shared/components/settings/BackupSection.module.css', 'utf8');
        const jsx = readFileSync('packages/core/src/shared/components/settings/BackupSection.jsx', 'utf8');
        expect(css).toMatch(/\.rowAction\s*\{[^}]*margin-block:\s*var\(--xc-space-1\)/);
        expect(jsx).toMatch(/className=\{styles\.rowAction\}/);
    });

    it('gives each row its block inset back inside the Settings page card', () => {
        const css = readFileSync('packages/core/src/shared/components/settings/BackupSection.module.css', 'utf8');
        expect(css).toMatch(/\.rows\.rows > \[data-settings-row\]\s*\{\s*padding-block:\s*var\(--xc-space-2\);/);
        mount();
        const row = screen.getByRole('heading', { name: 'Export encrypted backup' }).closest('[data-settings-row]');
        expect(row.parentElement.className).toMatch(/rows/);
    });
});
