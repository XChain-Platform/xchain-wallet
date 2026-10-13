// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A Settings section that cannot load its record shows fixed copy, never the
// developer text the hook or the shell bridge raised. Mounted for real through
// the real useSettings hook; only the messaging bridge is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let messagingStub;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingStub }),
}));

const {
    SETTINGS_LOAD_FALLBACK,
    settingsLoadErrorText,
} = await import('../../../packages/core/src/shared/components/settings/_settingsPrimitives.jsx');
const { NetworkSection } = await import('../../../packages/core/src/shared/components/settings/NetworkSection.jsx');
const { KeyboardSection } = await import('../../../packages/core/src/shared/components/settings/KeyboardSection.jsx');
const { LanguageRegionSection } = await import(
    '../../../packages/core/src/shared/components/settings/LanguageRegionSection.jsx'
);

let warnSpy;

beforeEach(() => {
    messagingStub = {};
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    cleanup();
    warnSpy.mockRestore();
});

describe('settingsLoadErrorText', () => {
    it('replaces the hook shell-gap error with the fallback copy', () => {
        expect(settingsLoadErrorText(new Error('useSettings: messaging.getSettings is not available in this shell')))
            .toBe(SETTINGS_LOAD_FALLBACK);
    });

    it('replaces runtime internals with the fallback copy and logs the cause', () => {
        expect(settingsLoadErrorText(new Error("Cannot read properties of undefined (reading 'x')")))
            .toBe(SETTINGS_LOAD_FALLBACK);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot read properties of undefined'));
    });

    it('passes copy written for a user through', () => {
        expect(settingsLoadErrorText(new Error('Your wallet is locked.')))
            .toBe('Settings unavailable: Your wallet is locked.');
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('Settings sections on a load failure', () => {
    it.each([
        ['NetworkSection', NetworkSection],
        ['KeyboardSection', KeyboardSection],
        ['LanguageRegionSection', LanguageRegionSection],
    ])('%s shows the fallback, not the missing-wrapper message', async (_name, Section) => {
        render(<Section />);
        await screen.findByText(SETTINGS_LOAD_FALLBACK);
        expect(document.body.textContent).not.toContain('messaging.getSettings');
        expect(document.body.textContent).not.toContain('is not available in this shell');
    });

    it('shows copy written for a user that the bridge rejected with', async () => {
        messagingStub = { getSettings: async () => { throw new Error('Your wallet is locked.'); } };
        render(<NetworkSection />);
        await screen.findByText('Settings unavailable: Your wallet is locked.');
    });
});
