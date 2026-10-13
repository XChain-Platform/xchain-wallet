// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';
import { diagnosticDump } from '../../../packages/core/src/flows/diagnosticDump.js';

afterEach(() => cleanup());

function mount(dump = { version: 'test' }, shell = 'web') {
    render(
        <MessagingProvider
            shell={shell}
            messaging={{ getDiagnosticDump: vi.fn(async () => dump) }}
        >
            <AboutSection />
        </MessagingProvider>,
    );
}

describe('AboutSection diagnostics', () => {
    it('shows version, build hash, and platform', async () => {
        const dump = await diagnosticDump({
            vault: { settings: { get: async () => ({ activeNetwork: 'testnet' }) } },
            env: { shell: 'extension' },
            build: { gitCommit: 'abc123def456', profile: 'store' },
        });
        mount(dump);

        expect(screen.getByText(WALLET_VERSION)).toBeTruthy();
        expect(await screen.findByText('abc123def456')).toBeTruthy();
        expect(screen.getByText('extension')).toBeTruthy();
        expect(screen.getByText('store')).toBeTruthy();
        expect(screen.getByText('testnet')).toBeTruthy();
    });

    it('reports the native platform instead of the shared web host', async () => {
        const prior = globalThis.Capacitor;
        globalThis.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
        };
        try {
            mount({ wallet: { platform: 'web' }, settings: { activeNetwork: 'mainnet' } });
            expect(await screen.findByText('android')).toBeTruthy();
        } finally {
            if (prior === undefined) delete globalThis.Capacitor;
            else globalThis.Capacitor = prior;
        }
    });

    it('opens every document link externally without an opener', () => {
        mount();
        const links = screen.getAllByRole('link');

        expect(links.length).toBeGreaterThanOrEqual(5);
        for (const link of links) {
            expect(link.href).toMatch(/^https:\/\//);
            expect(link.target).toBe('_blank');
            expect(link.rel).toBe('noreferrer noopener');
        }
    });

    it('stamps the extension HTML with the runtime build profile', () => {
        const config = readFileSync('packages/extension/vite.config.js', 'utf8');

        expect(config).toMatch(/transformIndexHtml\(\)[\s\S]*?name: 'xchain-build-profile',[\s\S]*?content: profile/);
    });

    it('redacts a stale host response before copying it', async () => {
        const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            mount({
                password: 'hunter2',
                address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
                confirmedBalanceSats: 125000000,
                apiToken: 'support-session-secret',
            });
            fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

            await screen.findByText(/Copied/);
            const copied = writeText.mock.calls[0][0];
            expect(copied).not.toContain('hunter2');
            expect(copied).not.toContain('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
            expect(copied).not.toContain('125000000');
            expect(copied).not.toContain('support-session-secret');
            expect(copied).toContain('[REDACTED]');
            expect(JSON.parse(copied).wallet).toEqual({ version: WALLET_VERSION, platform: 'web' });
        } finally {
            if (prior) Object.defineProperty(navigator, 'clipboard', prior);
            else delete navigator.clipboard;
        }
    });

    it('reports that copy is unavailable instead of claiming success', async () => {
        const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        try {
            mount();
            fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

            expect(await screen.findByText(/Copy is not available here/)).toBeTruthy();
            expect(screen.queryByText(/Copied/)).toBeNull();
        } finally {
            if (prior) Object.defineProperty(navigator, 'clipboard', prior);
            else delete navigator.clipboard;
        }
    });

    it('uses the page scroll for long diagnostics and license text', async () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Show preview' }));
        const preview = await screen.findByText(/"version": "test"/);
        expect(preview.style.overflow).toBe('');
        expect(preview.style.maxHeight).toBe('');

        fireEvent.click(screen.getByRole('button', { name: 'Show full text' }));
        const license = document.getElementById('full-license-text');
        expect(license.style.overflow).toBe('');
        expect(license.style.maxHeight).toBe('');
    });

    it('renders license copy as naturally wrapping paragraphs', () => {
        mount();

        const summary = screen.getByText(/XChain Wallet is free/).parentElement;
        expect([...summary.querySelectorAll('p')].every((paragraph) => !paragraph.textContent.includes('\n'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Show full text' }));
        const license = document.getElementById('full-license-text');
        const paragraphs = [...license.querySelectorAll('p')];
        expect(paragraphs.length).toBeGreaterThan(1);
        expect(paragraphs.every((paragraph) => !paragraph.textContent.includes('\n'))).toBe(true);
    });

    it('opens the repository issue form with redacted diagnostics only', async () => {
        const location = { replace: vi.fn() };
        const reportWindow = { location, opener: {}, close: vi.fn() };
        const open = vi.spyOn(globalThis, 'open').mockReturnValue(reportWindow);
        const diagnostics = {
            wallet: { version: 'test' },
            recent_errors: [{ message: 'redacted:sha256:1234abcd' }],
        };
        try {
            mount(diagnostics);
            fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));

            await waitFor(() => expect(location.replace).toHaveBeenCalledOnce());
            const reportUrl = new URL(location.replace.mock.calls[0][0]);
            expect(reportUrl.origin + reportUrl.pathname).toBe('https://github.com/XChain-Platform/xchain-wallet/issues/new');
            expect(reportUrl.searchParams.get('body')).toContain(JSON.stringify({
                ...diagnostics,
                wallet: { version: WALLET_VERSION, platform: 'web' },
                build: { profile: 'default' },
            }, null, 2));
            expect(reportUrl.searchParams.get('body')).toContain('redacted:sha256:1234abcd');
            expect(open).toHaveBeenCalledWith('about:blank', '_blank');
            expect(reportWindow.opener).toBeNull();
        } finally {
            open.mockRestore();
        }
    });
});
