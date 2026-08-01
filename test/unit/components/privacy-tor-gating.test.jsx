// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the Tor toggle must not be OFFERED where it cannot work.
//
// The gate is a runtime conditional, not build-time dead-code
// elimination, so the hint string is compiled into every shell's bundle.
// That is harmless as long as the row never RENDERS on a shell whose
// host cannot proxy, which is exactly what a source-level grep cannot
// tell you. This renders the real component both ways.

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
    it('is NOT offered when the shell has declared nothing', () => {
        // Web and extension never declare it. The setting is even true
        // here, so this is the exact case that used to lie: a user with
        // torRouting on, in a shell that cannot honour it.
        render(<PrivacySection />);
        expect(screen.queryByText('Tor routing')).toBeNull();
    });

    it('is NOT offered when the shell explicitly cannot proxy', () => {
        setShellCapabilities({ socksProxy: false });
        render(<PrivacySection />);
        expect(screen.queryByText('Tor routing')).toBeNull();
    });

    it('IS offered when the shell can proxy', () => {
        setShellCapabilities({ socksProxy: true });
        render(<PrivacySection />);
        expect(screen.getByText('Tor routing')).toBeTruthy();
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
