// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Settings → Privacy "clipboard auto-clear" control is gone,
// and the schema field it wrote is not.
//
// The two halves are tested together on purpose, because the failure this
// item existed to close lives in the gap between them. a later change made key
// material uncopyable, which deleted the setting's only reader; the control
// kept writing `settings.privacy.clipboardAutoClearSeconds` regardless. A
// privacy-minded user reading that row came away believing the wallet wipes
// their clipboard on a timer, which it does not, for anything.
//
// Removing the control is the honest fix. Removing the schema field with it
// would not be: stored vaults already carry the key, so dropping it turns a
// UI cleanup into a settings migration, and a future copy path (addresses,
// txids) can claim the value back without a schema bump.
//
// This renders the real component rather than grepping it. A stale row left
// behind a conditional, or one moved into a subcomponent, is invisible to
// source matching and perfectly visible here.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import {
    createDefaultSettings,
    validateSettings,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
} from '../../../packages/core/src/schemas/settings.js';
import { resetShellCapabilities } from '../../../packages/core/src/shared/shellCapabilities.js';

const update = vi.fn(async () => {});

// A settings record that still carries the field, which is the realistic
// case: every wallet created before this change has it stored.
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

describe('the Privacy panel after', () => {
    it('offers no clipboard auto-clear control', () => {
        render(<PrivacySection />);
        expect(screen.queryByLabelText(/clipboard/i)).toBeNull();
        expect(screen.queryByText(/clipboard/i)).toBeNull();
    });

    it('renders no number input at all, whatever it might be labelled', () => {
        // The clipboard row was this panel's only spinbox. Asserting on the
        // role rather than the label is what catches a renamed revival: a row
        // called "Clear copied data after (seconds)" would pass a text check
        // and still make the same unkept promise.
        render(<PrivacySection />);
        expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    });

    it('does not write the orphaned setting on render', () => {
        // The removed handler clamped and persisted on mount-adjacent paths.
        // Nothing should touch the key now, least of all silently.
        render(<PrivacySection />);
        expect(update).not.toHaveBeenCalled();
    });

    it('leaves the rows that still govern something in place', () => {
        render(<PrivacySection />);
        expect(screen.getByText('Change-address rotation')).toBeTruthy();
        expect(screen.getByText('Hide small balances')).toBeTruthy();
        expect(screen.getByText('Form draft retention')).toBeTruthy();
    });
});

describe('the clipboard setting itself', () => {
    it('is still seeded by createDefaultSettings', () => {
        // Compatibility half of the ruling: the field stays in the schema so
        // removing the control is not a stored-settings migration.
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
