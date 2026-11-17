// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 and G08 on Settings > Automatic Donations: each changeable row carries
// a tip written for it, the rows are the shared SettingsInlineRow in labelled
// group cards, and the header card has no progress bar.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const settings = createDefaultSettings();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));

const { AdsSection } = await import(
    '../../../packages/core/src/shared/components/settings/AdsSection.jsx'
);

afterEach(() => cleanup());

describe('Automatic Donations row tips (U57)', () => {
    it.each([
        ['ads-per-transaction', /every mainnet transaction this wallet sends, on any blockchain\. Testnet and regtest sends add nothing/],
        ['ads-send-at', /if that address can also cover it and its fee/],
        ['ads-donate-to', /The review screen names the donation before you approve/],
    ])('explains %s from its tip', (id, help) => {
        render(<AdsSection />);
        const rowNode = document.querySelector(`[data-settings-row-id="${id}"]`);
        fireEvent.click(within(rowNode).getAllByRole('button').find((b) => !b.getAttribute('aria-haspopup')
            && b.getAttribute('role') !== 'combobox'));
        expect(screen.getByText(help)).toBeTruthy();
    });
});

describe('Automatic Donations layout (G08)', () => {
    it('renders every row through the shared inline row inside labelled cards', () => {
        render(<AdsSection />);
        expect(screen.getByRole('list', { name: 'Donation' }).querySelectorAll('[data-settings-inline]')).toHaveLength(3);
        expect(screen.getByRole('list', { name: 'Totals' }).querySelectorAll('[data-settings-inline="static"]')).toHaveLength(2);
    });

    it('uses the heart in the Notice Standard instead of a custom header card', () => {
        render(<AdsSection />);
        const hero = screen.getByTestId('ads-hero');
        expect(hero).toHaveAttribute('data-tone', 'info');
        expect(hero.querySelector('.lucide-heart')).not.toBeNull();
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings/AdsSection.module.css'), 'utf8');
        expect(css).not.toMatch(/\.hero\s*\{/);
        expect(css).toMatch(/\.heroNotice > span:first-child svg\s*\{[^}]*width:\s*var\(--xc-space-8\);/s);
    });
});
