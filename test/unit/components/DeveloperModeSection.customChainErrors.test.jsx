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
// Remove network sits on the custom network's own page (operator picks
// 2026-11-14).

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

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

const { customChainErrorText } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);
const { TestNetworkPage, buildCustomDescriptor } = await import(
    '../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx'
);

const CHAIN_ID = 'errors-fork-regtest';

beforeEach(() => {
    settings = { ...createDefaultSettings(), developerMode: true, fees: {} };
    messaging = {
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
        removeCustomChain: vi.fn(async () => {
            throw new Error(`removeCustomChain: "${CHAIN_ID}" still holds addresses in a wallet account, so it can't be removed. Its funds stay reachable while the network is installed.`);
        }),
    };
    const registry = defaultRegistry();
    registry.addCustom(buildCustomDescriptor(registry.get('bitcoin-regtest'), {
        name: 'Errors Fork',
        id: CHAIN_ID,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18090 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3033 },
    }));
});

afterEach(() => {
    cleanup();
    try { defaultRegistry().removeCustom(CHAIN_ID); } catch { /* already gone */ }
});

describe('custom network error text', () => {
    it('shows a plain sentence when a removal fails', async () => {
        const onReturnTo = vi.fn();
        render(<TestNetworkPage chainId={CHAIN_ID} activeWallet={{ id: 'wallet-1' }} onReturnTo={onReturnTo} />);
        fireEvent.click(await screen.findByRole('button', { name: /^Remove network/ }));

        expect(await screen.findByText(`"${CHAIN_ID}" still holds addresses in a wallet account, so it can't be removed. Its funds stay reachable while the network is installed.`)).toBeTruthy();
        expect(screen.queryByText(/removeCustomChain/)).toBeNull();
        expect(onReturnTo).not.toHaveBeenCalled();
        // A refused removal leaves the network installed in this realm.
        expect(defaultRegistry().has(CHAIN_ID)).toBe(true);
    });

    it('drops the function-name prefix of the add path too', () => {
        expect(customChainErrorText(new Error('addCustomChain: invalid descriptor: id is required'), 'x'))
            .toBe('Invalid descriptor: id is required.');
        expect(customChainErrorText(new Error(''), 'Failed to remove custom network.'))
            .toBe('Failed to remove custom network.');
        expect(customChainErrorText(new Error('removeCustomChain: "bitcoin-mainnet" is a bundled chain and cannot be removed'), 'x'))
            .toBe('"bitcoin-mainnet" is a built-in network and can\'t be removed.');
    });
});
