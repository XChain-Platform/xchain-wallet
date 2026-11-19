// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    openSelectListbox,
    selectOption,
    selectOptionDetails,
    selectOptionValues,
} from '../../helpers/selectOption.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

function renderPrivateKeyLane() {
    render(
        <MessagingProvider shell="web" messaging={{}}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
}

function coinField() {
    return screen.getByRole('button', { name: /^Coin: / });
}

function networkField() {
    return screen.getByRole('button', { name: /^Coin network: / });
}

function registryNetworks(coin) {
    return defaultRegistry().supportedChains()
        .filter((descriptor) => descriptor.coin === coin
            && Number.isInteger(descriptor.wifVersionByte))
        .map((descriptor) => descriptor.networkKind);
}

afterEach(cleanup);

describe('ImportWallet private key network picker', () => {
    it('lists each WIF coin family once with its coin icon', () => {
        renderPrivateKeyLane();
        expect(selectOptionDetails(coinField())).toEqual([
            { value: 'bitcoin', label: 'Bitcoin', disabled: false, selected: true },
            { value: 'litecoin', label: 'Litecoin', disabled: false, selected: false },
            { value: 'dogecoin', label: 'Dogecoin', disabled: false, selected: false },
        ]);

        const listbox = openSelectListbox(coinField());
        expect(listbox.querySelectorAll('[role="option"] img')).toHaveLength(3);
    });

    it.each(['bitcoin', 'litecoin', 'dogecoin'])(
        'lists exactly the registry networks for %s with icons',
        (coin) => {
            renderPrivateKeyLane();
            selectOption(coinField(), coin);

            expect(selectOptionValues(networkField())).toEqual(registryNetworks(coin));
            const listbox = openSelectListbox(networkField());
            expect(listbox.querySelectorAll('[role="option"] img'))
                .toHaveLength(registryNetworks(coin).length);
        },
    );

    it('defaults both fields to Bitcoin Mainnet', () => {
        renderPrivateKeyLane();
        expect(coinField()).toHaveAccessibleName('Coin: Bitcoin');
        expect(networkField()).toHaveAccessibleName('Coin network: Mainnet');
    });
});
