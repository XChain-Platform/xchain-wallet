// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a failed custom network add or remove shows a plain sentence, without
// the internal function-name prefix the host and flows lead their messages with.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let messaging;
let settings;
const update = vi.fn();

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/components/LogConsole.jsx', () => ({ LogConsole: () => null }));

const { DeveloperModeSection, customChainErrorText } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);

beforeEach(() => {
    settings = { ...createDefaultSettings(), developerMode: true };
    messaging = {
        listConnectedSites: vi.fn(async () => []),
        listWallets: vi.fn(async () => [{ id: 'wallet-1' }]),
        listCustomChains: vi.fn(async () => ({ descriptors: [{ id: 'bitcoin-mainnet', displayName: 'Bitcoin' }] })),
        removeCustomChain: vi.fn(async () => {
            throw new Error('removeCustomChain: "bitcoin-mainnet" is a bundled chain and cannot be removed');
        }),
    };
});

afterEach(() => cleanup());

describe('custom network error text', () => {
    it('shows a plain sentence when a removal fails', async () => {
        render(<DeveloperModeSection />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove custom network bitcoin-mainnet' }));

        expect(await screen.findByText('"bitcoin-mainnet" is a built-in network and can\'t be removed.')).toBeTruthy();
        expect(screen.queryByText(/removeCustomChain/)).toBeNull();
    });

    it('drops the function-name prefix of the add path too', () => {
        expect(customChainErrorText(new Error('addCustomChain: invalid descriptor: id is required'), 'x'))
            .toBe('Invalid descriptor: id is required.');
        expect(customChainErrorText(new Error(''), 'Failed to remove custom network.'))
            .toBe('Failed to remove custom network.');
    });
});
