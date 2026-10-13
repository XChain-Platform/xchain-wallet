// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Tor toggle must not be OPERABLE where it cannot
// work, and the shells that cannot work it say so out loud.
//
// The gate is a runtime conditional, not build-time dead-code
// elimination, so both hint strings are compiled into every shell's
// bundle. What matters is which one RENDERS on a shell whose host cannot
// proxy, which is exactly what a source-level grep cannot tell you. This
// renders the real component both ways.
//
// Operator ruling on (2026-08-11) chose the disclosure over the
// silence: web and extension carry an explicit
// not-available-on-this-platform state rather than dropping the row.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import {
    setShellCapabilities,
    resetShellCapabilities,
} from '../../../packages/core/src/shared/shellCapabilities.js';

// The section only needs settings to render; stub the hook so this test
// is about the gate and nothing else.
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: {
            privacy: {
                torRouting: true,
                changeAddressRotation: false,
                hideSmallBalances: false,
                blurOnBlur: false,
                labelsSurviveRestore: false,
                hapticsEnabled: true,
                priceDataEnabled: true,
                metadataFetchEnabled: true,
                clipboardAutoClearSeconds: 60,
            },
            formDraftTtlMs: 0,
        },
        loading: false,
        error: null,
        update: async () => {},
    }),
}));

const { PrivacySection } = await import(
    '../../../packages/core/src/shared/components/settings/PrivacySection.jsx');

afterEach(() => {
    cleanup();
    resetShellCapabilities();
});

describe('the Tor routing row', () => {
    it('is NOT operable when the shell has declared nothing', () => {
        // Web and extension never declare it. The setting is even true
        // here, so this is the exact case that used to lie: a user with
        // torRouting on, in a shell that cannot honour it. The switch
        // must read OFF and refuse input, whatever the vault says.
        render(<PrivacySection />);
        const sw = screen.getByRole('switch', { name: 'Tor routing' });
        expect(sw.disabled).toBe(true);
        expect(sw.checked).toBe(false);
    });

    it('says WHY it is unavailable instead of vanishing', () => {
        setShellCapabilities({ socksProxy: false });
        render(<PrivacySection />);
        expect(screen.getByText('Tor routing')).toBeTruthy();
        const hint = screen.getByText(/Not available on this platform/i);
        // Naming the shell that can do it is the point: a bare "no"
        // reads as "this wallet has no Tor support at all".
        expect(hint.textContent).toMatch(/desktop app/i);
        // The live copy must not be the one showing here.
        expect(screen.queryByText(/Tor must already be running/i)).toBeNull();
    });

    it('IS offered, live, when the shell can proxy', () => {
        setShellCapabilities({ socksProxy: true });
        render(<PrivacySection />);
        expect(screen.getByText('Tor routing')).toBeTruthy();
        const sw = screen.getByRole('switch', { name: 'Tor routing' });
        expect(sw.disabled).toBe(false);
        // The stubbed settings have torRouting on; a proxying shell
        // reflects it rather than forcing it off.
        expect(sw.checked).toBe(true);
        expect(screen.queryByText(/Not available on this platform/i)).toBeNull();
    });

    it('renders exactly one Tor row in either shell', () => {
        // Two independent conditionals guard the two copies. If both
        // ever rendered, the user would see contradictory rows.
        render(<PrivacySection />);
        expect(screen.getAllByText('Tor routing')).toHaveLength(1);
        cleanup();
        setShellCapabilities({ socksProxy: true });
        render(<PrivacySection />);
        expect(screen.getAllByText('Tor routing')).toHaveLength(1);
    });

    it('tells the user it fails rather than silently going direct', () => {
        setShellCapabilities({ socksProxy: true });
        render(<PrivacySection />);
        // The old hint said "when available", which implied a graceful
        // fallback and would have made the setting meaningless.
        const hint = screen.getByText(/Tor must already be running/i);
        expect(hint.textContent).toMatch(/requests fail rather than quietly going direct/i);
    });

    it('leaves the other privacy rows alone either way', () => {
        render(<PrivacySection />);
        expect(screen.getByText('Change-address rotation')).toBeTruthy();
        cleanup();
        setShellCapabilities({ socksProxy: true });
        render(<PrivacySection />);
        expect(screen.getByText('Change-address rotation')).toBeTruthy();
    });
});
