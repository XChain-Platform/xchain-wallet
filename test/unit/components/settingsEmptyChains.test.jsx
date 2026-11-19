// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let hookState;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => hookState,
}));

const { FeesSection } = await import(
    '../../../packages/core/src/shared/components/settings/FeesSection.jsx'
);
const { AdsSection } = await import(
    '../../../packages/core/src/shared/components/settings/AdsSection.jsx'
);

const chainListSections = [
    ['Fees', FeesSection, 'No network fee profiles yet'],
];
const sections = [
    ...chainListSections,
    ['Automatic Donations', AdsSection, null],
];

beforeEach(() => {
    hookState = {
        settings: createDefaultSettings(),
        loading: false,
        error: null,
        update: vi.fn(),
    };
});

afterEach(() => cleanup());

describe('settings chain-list states', () => {
    it.each(chainListSections)('%s renders an EmptyState when it has zero chains', (_name, Section, copy) => {
        const { container } = render(<Section />);

        const emptyState = container.querySelector('[data-empty-state]');
        expect(emptyState).not.toBeNull();
        expect(emptyState).toHaveTextContent(copy);
        expect(container.querySelector('[data-variant]')).toBeNull();
    });

    // Donations are one wallet-wide setting (ruling 2026-11-14), so the page
    // is whole before any network is set up.
    it('Automatic Donations needs no chains', () => {
        const { container, getByTestId } = render(<AdsSection />);
        expect(container.querySelector('[data-empty-state]')).toBeNull();
        expect(getByTestId('ads-hero')).toHaveTextContent('$0.05 per transaction');
    });

    it.each(sections)('%s keeps a failed read as a status notice', (_name, Section) => {
        hookState = {
            settings: null,
            loading: false,
            error: new Error('Your wallet is locked.'),
            update: vi.fn(),
        };

        const { container } = render(<Section />);

        expect(container.querySelector('[data-empty-state]')).toBeNull();
        const notice = container.querySelector('[data-variant="error"]');
        expect(notice).not.toBeNull();
        expect(notice).toHaveTextContent('Settings unavailable: Your wallet is locked.');
    });
});
