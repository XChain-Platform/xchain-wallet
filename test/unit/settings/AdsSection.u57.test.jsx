// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// U57 and U33 on Settings > Automatic donation system: each per-chain field
// carries a tip written for it, and each chain card keeps a block inset so
// its last line never sits on the row divider under it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const settings = seedSettingsForChains(
    { ...createDefaultSettings(), activeNetwork: 'mainnet' },
    defaultRegistry(),
    ['bitcoin-mainnet'],
);
settings.ads = { ...settings.ads, enabled: true };

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));

const { AdsSection } = await import(
    '../../../packages/core/src/shared/components/settings/AdsSection.jsx'
);

afterEach(() => cleanup());

function chainCard() {
    return screen.getByRole('heading', { level: 2, name: 'Bitcoin' }).parentElement;
}

describe('Ads per-chain field tips (U57)', () => {
    it.each([
        [/^Set aside per outgoing transaction/, /set aside from each outgoing transaction/],
        [/^Send donation when pending reaches/, /sent as one donation with your next transaction/],
        [/^Donate to/, /published donation address on this network receives/],
        [/^Donation address/, /read from the network registry/],
    ])('explains %s from its label tip', (label, help) => {
        render(<AdsSection />);
        const card = chainCard();
        const labelNode = within(card).getAllByText(label)[0];
        const row = labelNode.closest('div');
        const tip = within(row).getByRole('button');
        fireEvent.click(tip);
        expect(within(card).getByText(help)).toBeTruthy();
    });
});

describe('Ads chain card inset (U33)', () => {
    it('keeps a block inset on the first and last child, outside the card rule', () => {
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings/AdsSection.module.css'), 'utf8');
        expect(css).toMatch(/\.chain > :first-child\s*\{\s*margin-block-start:\s*var\(--xc-space-3\);/);
        expect(css).toMatch(/\.chain > :last-child\s*\{\s*margin-block-end:\s*var\(--xc-space-3\);/);
    });
});
