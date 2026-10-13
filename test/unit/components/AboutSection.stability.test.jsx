// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';

afterEach(() => cleanup());

function mount(dump = { version: 'test' }) {
    render(
        <MessagingProvider
            shell="web"
            messaging={{ getDiagnosticDump: vi.fn(async () => dump) }}
        >
            <AboutSection />
        </MessagingProvider>,
    );
}

describe('AboutSection diagnostics', () => {
    it('shows version, build hash, and platform', async () => {
        mount({
            wallet: { platform: 'extension' },
            build: { gitCommit: 'abc123def456' },
        });

        expect(screen.getByText('0.341.2')).toBeTruthy();
        expect(await screen.findByText('abc123def456')).toBeTruthy();
        expect(screen.getByText('extension')).toBeTruthy();
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

    it('redacts a stale host response before copying it', async () => {
        const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            mount({
                password: 'hunter2',
                address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
            });
            fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

            await screen.findByText(/Copied/);
            const copied = writeText.mock.calls[0][0];
            expect(copied).not.toContain('hunter2');
            expect(copied).not.toContain('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
            expect(copied).toContain('[REDACTED]');
            expect(JSON.parse(copied).wallet).toEqual({ version: '0.341.2', platform: 'web' });
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
});
