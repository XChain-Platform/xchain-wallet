// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Sign message offers software addresses only. The signing host derives or
// reads the key from the unlocked vault, so a hardware address would collect a
// password and then fail.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const SOFT = {
    id: 'soft-1', address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', role: 'receive',
};
const HW = {
    id: 'hw-1', address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    derivationPath: "m/84'/0'/0'/0/1", source: 'trezor', signerId: 'signer-1', role: 'receive',
};

function mount(addresses) {
    const target = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: addresses }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: addresses[0] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            object[property] = vi.fn().mockResolvedValue(null);
            return object[property];
        },
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SignMessageForm walletId="wallet-hw" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Sign message address list', () => {
    it('leaves hardware addresses out of the Address select', async () => {
        mount([HW, SOFT]);
        const select = await screen.findByLabelText('Address');
        const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(values).toContain(SOFT.id);
        expect(values).not.toContain(HW.id);
        // The default address is chosen in an effect after the options render.
        await waitFor(() => expect(select).toHaveValue(SOFT.id));
    });

    it("says hardware addresses can't sign when they are the only ones", async () => {
        mount([HW]);
        expect(await screen.findByText(/Trezor and Ledger addresses can't sign messages/)).toBeTruthy();
    });
});
