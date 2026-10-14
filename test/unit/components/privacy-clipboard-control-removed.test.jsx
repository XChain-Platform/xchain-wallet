// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Privacy control remains connected to the validated settings field that
// drives sensitive clipboard retention in every shell.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import {
    createDefaultSettings,
    validateSettings,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
} from '../../../packages/core/src/schemas/settings.js';
import { resetShellCapabilities } from '../../../packages/core/src/shared/shellCapabilities.js';

const update = vi.fn(async () => {});

// The fixture carries a non-default value so the rendered control proves it
// reads the stored preference rather than only displaying the default.
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: {
            privacy: {
                torRouting: false,
                changeAddressRotation: false,
                hideSmallBalances: false,
                blurOnBlur: false,
                labelsSurviveRestore: false,
                hapticsEnabled: true,
                priceDataEnabled: true,
                metadataFetchEnabled: true,
                clipboardAutoClearSeconds: 90,
                formDraftTtlMs: 0,
            },
        },
        loading: false,
        error: null,
        update,
    }),
}));

const { PrivacySection } = await import(
    '../../../packages/core/src/shared/components/settings/PrivacySection.jsx');

afterEach(() => {
    cleanup();
    resetShellCapabilities();
    update.mockClear();
});

describe('the Privacy clipboard control', () => {
    it('shows the stored auto-clear delay and its allowed range', () => {
        render(<PrivacySection />);
        const input = screen.getByLabelText('Clipboard auto-clear seconds');
        expect(input).toHaveValue(90);
        expect(input).toHaveAttribute('min', '0');
        expect(input).toHaveAttribute('max', '600');
        expect(screen.getByText(/Set to 0 to keep them until they are replaced/)).toBeTruthy();
    });

    it('persists zero as the never-clear choice', async () => {
        render(<PrivacySection />);
        fireEvent.change(screen.getByLabelText('Clipboard auto-clear seconds'), {
            target: { value: '0' },
        });

        await waitFor(() => expect(update).toHaveBeenCalledWith({
            privacy: { clipboardAutoClearSeconds: 0 },
        }));
    });

    it('leaves the rows that still govern something in place', () => {
        render(<PrivacySection />);
        expect(screen.getByText('Change-address rotation')).toBeTruthy();
        expect(screen.getByText('Clipboard auto-clear')).toBeTruthy();
        expect(screen.getByText('Form draft retention')).toBeTruthy();
    });
});

describe('the clipboard setting itself', () => {
    it('is still seeded by createDefaultSettings', () => {
        const s = createDefaultSettings();
        expect(s.privacy.clipboardAutoClearSeconds).toBe(CLIPBOARD_AUTO_CLEAR_DEFAULT);
    });

    it('still validates on records written by older builds', () => {
        const s = createDefaultSettings();
        expect(validateSettings({
            ...s,
            privacy: { ...s.privacy, clipboardAutoClearSeconds: 90 },
        }).ok).toBe(true);
    });

    it('still validates on records that never had it', () => {
        const s = createDefaultSettings();
        const { clipboardAutoClearSeconds, ...privacy } = s.privacy;
        expect(clipboardAutoClearSeconds).toBeDefined();
        expect(validateSettings({ ...s, privacy }).ok).toBe(true);
    });
});
