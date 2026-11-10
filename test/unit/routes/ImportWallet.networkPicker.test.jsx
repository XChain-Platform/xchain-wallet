// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Onboarding accepts mainnet private keys. Testnet and regtest remain in the
// in-wallet Add or import address dialog for advanced use.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { tickerForCoin } from '../../../packages/core/src/registry/coinTicker.js';

function renderPrivateKeyLane() {
    render(
        <MessagingProvider shell="web" messaging={{}}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
}

function openNetworkPicker() {
    fireEvent.click(screen.getByRole('button', { name: /^Coin network: / }));
    return screen.getByRole('listbox', { name: 'Coin network' });
}

function wifChains() {
    return defaultRegistry().supportedChains()
        .filter((descriptor) => descriptor.networkKind === 'mainnet'
            && Number.isInteger(descriptor.wifVersionByte));
}

function optionText(option) {
    return option.textContent.replace(/\s+/g, ' ').trim();
}

afterEach(cleanup);

describe('ImportWallet private key network picker', () => {
    it('offers only mainnet coins with WIF support', () => {
        renderPrivateKeyLane();
        const options = within(openNetworkPicker()).getAllByRole('option');
        const chains = wifChains();
        expect(options).toHaveLength(chains.length);
        options.forEach((option, index) => {
            const descriptor = chains[index];
            const ticker = tickerForCoin(descriptor.coin);
            expect(descriptor.networkKind).toBe('mainnet');
            expect(optionText(option)).toBe(`${descriptor.displayName}${ticker}`);
            expect(computeAccessibleName(option)).not.toMatch(/testnet|regtest/);
        });
        expect(chains.map((descriptor) => descriptor.id).sort()).toEqual([
            'bitcoin-mainnet',
            'dogecoin-mainnet',
            'litecoin-mainnet',
        ]);
    });
});
