// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A private key decodes to a different address on each network of a coin, so
// the network picker tells mainnet, testnet and regtest apart. The visible
// rows keep the plain coin name and ticker; each option's accessible name
// carries its network.

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
    fireEvent.click(screen.getByRole('button', { name: /^Private key network: / }));
    return screen.getByRole('listbox', { name: 'Private key network' });
}

function wifChains() {
    return defaultRegistry().supportedChains()
        .filter((descriptor) => Number.isInteger(descriptor.wifVersionByte));
}

function optionText(option) {
    return option.textContent.replace(/\s+/g, ' ').trim();
}

afterEach(cleanup);

describe('ImportWallet private key network picker', () => {
    it('gives every network of a coin its own option name', () => {
        renderPrivateKeyLane();
        const options = within(openNetworkPicker()).getAllByRole('option');
        const chains = wifChains();
        expect(options).toHaveLength(chains.length);

        const byCoin = new Map();
        options.forEach((option, index) => {
            const names = byCoin.get(chains[index].coin) ?? [];
            names.push(computeAccessibleName(option));
            byCoin.set(chains[index].coin, names);
        });
        for (const [coin, names] of byCoin) {
            expect(names.length, `${coin} offers more than one network`).toBeGreaterThan(1);
            expect(new Set(names).size, `${coin} offers ${names.join(' | ')}`).toBe(names.length);
        }
    });

    it('keeps the plain coin name on mainnet and names testnet and regtest', () => {
        renderPrivateKeyLane();
        const options = within(openNetworkPicker()).getAllByRole('option');
        const chains = wifChains();
        expect(new Set(chains.map((descriptor) => descriptor.networkKind)))
            .toEqual(new Set(['mainnet', 'testnet', 'regtest']));

        options.forEach((option, index) => {
            const descriptor = chains[index];
            const ticker = tickerForCoin(descriptor.coin);
            const name = computeAccessibleName(option);
            // Visible text stays the plain coin name over its ticker on every network.
            expect(optionText(option)).toBe(`${descriptor.displayName}${ticker}`);
            if (descriptor.networkKind === 'mainnet') {
                expect(name).not.toMatch(/testnet|regtest/);
                expect(name.startsWith(descriptor.displayName)).toBe(true);
            } else {
                expect(name).toBe(`${descriptor.displayName} ${descriptor.networkKind} ${ticker}`);
            }
        });
    });
});
