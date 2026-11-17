// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The address detail's Receive tile hands Receive the address it shows, as
// prefill.address. Receive opens on that address, not the chain's newest one;
// with none passed, or one the chain does not hold, it opens as before.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async (value) => `data:image/png;base64,${value}`) },
}));

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};
const OLD = { id: 'a0', address: 'bcrt1qoldaddress', addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0" };
const NEWEST = { id: 'a1', address: 'bcrt1qnewestaddr', addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/1" };

function mount(prefill) {
    return render(
        <MessagingProvider shell="web" messaging={{
            getSettings: async () => SETTINGS,
            getAddressesByChain: async () => ({ 'bitcoin-regtest': [OLD, NEWEST] }),
            getNewestAddress: async () => NEWEST,
            getSupportedAddressTypes: async () => ({ supported: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'] }),
        }}
        >
            <Receive walletId="w1" accountId="acct-1" prefill={prefill} />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('Receive with an address passed in', () => {
    it('shows the passed address instead of the newest', async () => {
        mount({ chainId: 'bitcoin-regtest', address: OLD.address });
        expect(await screen.findByDisplayValue(OLD.address)).toBeTruthy();
        expect(screen.queryByDisplayValue(NEWEST.address)).toBeNull();
    });

    it('shows the newest address when none is passed', async () => {
        mount({ chainId: 'bitcoin-regtest' });
        expect(await screen.findByDisplayValue(NEWEST.address)).toBeTruthy();
        expect(screen.queryByDisplayValue(OLD.address)).toBeNull();
    });

    it('falls back to the newest address when the passed one is not on the chain', async () => {
        mount({ chainId: 'bitcoin-regtest', address: 'bcrt1qstranger' });
        expect(await screen.findByDisplayValue(NEWEST.address)).toBeTruthy();
    });
});
