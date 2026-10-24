// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Receive opens on a type the installed SDK can generate. A wallet whose newest
// address is p2tr (a type SDK 0.23.0 refuses) falls back to the chain default;
// the p2tr record stays in the vault untouched.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};
const TAPROOT = { id: 't1', address: 'bcrt1ptaproot', addressType: 'p2tr', derivationPath: "m/86'/1'/0'/0/3" };
const SEGWIT = { id: 's1', address: 'bcrt1qsegwit', addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0" };

describe('Receive when the stored address type is p2tr', () => {
    it('opens on the default type and does not offer P2TR', async () => {
        const getSupportedAddressTypes = vi.fn(async () => ({ supported: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'] }));
        render(
            <MessagingProvider shell="web" messaging={{
                getSettings: async () => SETTINGS,
                getAddressesByChain: async () => ({ 'bitcoin-regtest': [SEGWIT, TAPROOT] }),
                getNewestAddress: async () => TAPROOT,
                getSupportedAddressTypes,
            }}
            >
                <Receive walletId="w1" accountId="acct-1" />
            </MessagingProvider>,
        );

        await waitFor(() => expect(getSupportedAddressTypes).toHaveBeenCalled());
        const select = await screen.findByLabelText('Address type');
        await waitFor(() => expect(select.value).toBe('p2wpkh'));
        expect([...select.options].map((o) => o.value)).not.toContain('p2tr');
        expect(await screen.findByDisplayValue('bcrt1qsegwit')).toBeTruthy();
        expect(screen.queryByDisplayValue('bcrt1ptaproot')).toBeNull();
    });
});
