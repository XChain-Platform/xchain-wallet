// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the phone app's auto-lock "Never" choice names no tabs.
//
//   [P2] 2026-10-23: Settings in the Android app offered "Never (until tab
//        close)", and the app has no tabs.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { autolockMinutes: 0, grace: { testSendThresholdSats: 0 } },
        loading: false,
        error: null,
        update: vi.fn(),
    }),
}));
vi.mock('../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: {} }),
}));
vi.mock('../../packages/core/src/shared/components/settings/BiometricRow.jsx', () => ({ BiometricRow: () => null }));
vi.mock('../../packages/core/src/shared/components/settings/PanicModeRow.jsx', () => ({ PanicModeRow: () => null }));
vi.mock('../../packages/core/src/shared/components/settings/DuressPassphraseRow.jsx', () => ({ DuressPassphraseRow: () => null }));
vi.mock('../../packages/core/src/shared/components/settings/UndoSendRow.jsx', () => ({ UndoSendRow: () => null }));

const { SafetySection } = await import(
    '../../packages/core/src/shared/components/settings/SafetySection.jsx'
);

function neverOption() {
    const select = screen.getByLabelText('Auto-lock timeout');
    return Array.from(select.options).find((option) => option.value === '0');
}

afterEach(() => {
    cleanup();
    delete globalThis.Capacitor;
});

describe('regression/native-autolock-never-label', () => {
    it('[REGRESSION P2] names the app, not a tab, in the phone app', () => {
        globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
        render(<SafetySection />);

        expect(neverOption()).toHaveTextContent('Never (until the app closes)');
        expect(neverOption().textContent).not.toMatch(/tab/i);
    });

    it('[REGRESSION P2] keeps the tab wording in a browser', () => {
        render(<SafetySection />);

        expect(neverOption()).toHaveTextContent('Never (until tab close)');
    });
});
