// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The Change asset control at the top of Receive is the shared Button: it
// carries the Button base class plus exactly one variant and one size, as
// the button outline layout check requires, and keeps the Receive asset
// card class that draws the 48px circle.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import styles from '../../../packages/core/src/shared/routes/Receive.module.css';

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
const SIZES = ['sm', 'md', 'lg'];

const ADDRESS = { id: 'a1', address: 'bcrt1qchangeasset', addressType: 'p2wpkh' };

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

function baseMessaging(overrides = {}) {
    return {
        getSettings: async () => REGTEST_SETTINGS,
        getAddressesByChain: async () => ({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: async () => ADDRESS,
        ...overrides,
    };
}

function renderReceive(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="w1" accountId="acct-1" {...props} />
        </MessagingProvider>,
    );
}

describe('Receive Change asset control', () => {
    // The Change asset card is retired: Receive's Asset field is the shared
    // TokenField, a Button-based control that names its current selection.
    it('is the shared Asset field, a Button-based control naming its selection', async () => {
        renderReceive(baseMessaging());

        const control = await screen.findByRole('button', { name: /^Asset: BTC on / });
        const classes = control.className.split(/\s+/);

        expect(classes).toContain(buttonStyles.btn);
        expect(classes).not.toContain(styles.assetCard);
        // TokenField draws its own control, so no kit variant or size class rides on it.
        expect(VARIANTS.filter((variant) => classes.includes(buttonStyles[variant]))).toHaveLength(0);
        expect(SIZES.filter((size) => classes.includes(buttonStyles[size]))).toHaveLength(0);
        expect(screen.queryByRole('button', { name: /^Change asset/ })).toBeNull();
    });
});
