// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Privacy reset control restores only privacy keys, the clipboard field
// rejects out-of-range input, and the new default keys stay backward compatible.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import {
    createDefaultSettings,
    validateSettings,
    FORM_DRAFT_TTL_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
} from '../../../packages/core/src/schemas/settings.js';
import { resetShellCapabilities } from '../../../packages/core/src/shared/shellCapabilities.js';

const update = vi.fn(async () => {});

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: {
            privacy: {
                torRouting: false,
                changeAddressRotation: true,
                hideSmallBalances: true,
                blurOnBlur: true,
                labelsSurviveRestore: false,
                hapticsEnabled: false,
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

describe('Privacy reset and validation', () => {
    it('reset writes defaults for privacy controls only', async () => {
        render(<PrivacySection />);
        fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        const patch = update.mock.calls[0][0];
        expect(Object.keys(patch)).toEqual(['privacy']);
        expect(patch.privacy.changeAddressRotation).toBe(false);
        expect(patch.privacy.hapticsEnabled).toBe(true);
        expect(patch.privacy.clipboardAutoClearSeconds).toBe(CLIPBOARD_AUTO_CLEAR_DEFAULT);
        expect(patch.privacy.formDraftTtlMs).toBe(FORM_DRAFT_TTL_DEFAULT);
        expect(patch.privacy).not.toHaveProperty('hideSmallBalances');
    });

    it('rejects an out-of-range clipboard delay without saving', () => {
        render(<PrivacySection />);
        fireEvent.change(screen.getByLabelText('Clipboard auto-clear seconds'), {
            target: { value: '9999' },
        });
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toMatch(/whole number from 0 to 600/);
    });

    it('rejects an empty clipboard field instead of saving zero', () => {
        render(<PrivacySection />);
        fireEvent.change(screen.getByLabelText('Clipboard auto-clear seconds'), {
            target: { value: '' },
        });
        expect(update).not.toHaveBeenCalled();
    });
});

describe('seeded privacy defaults', () => {
    it('seed the two new keys', () => {
        const p = createDefaultSettings().privacy;
        expect(p.alwaysRequireHwExplicitConfirm).toBe(false);
        expect(p.formDraftTtlMs).toBe(FORM_DRAFT_TTL_DEFAULT);
    });

    it('still validate records that lack them', () => {
        const s = createDefaultSettings();
        const { alwaysRequireHwExplicitConfirm, formDraftTtlMs, ...privacy } = s.privacy;
        expect(alwaysRequireHwExplicitConfirm).toBe(false);
        expect(formDraftTtlMs).toBeDefined();
        expect(validateSettings({ ...s, privacy }).ok).toBe(true);
    });
});
