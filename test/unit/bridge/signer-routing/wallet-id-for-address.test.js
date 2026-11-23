// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { walletIdForAddress } from '../../../../packages/extension/src/bridge/handlers.js';

describe('walletIdForAddress', () => {
    it('resolves device ownership through the account and keeps software signer routing', async () => {
        const addresses = [
            {
                id: 'device-address', address: 'device', source: 'ledger',
                accountId: 'device-account', signerId: 'device-signer-record',
            },
            {
                id: 'software-address', address: 'software', source: 'hd',
                accountId: 'software-account', signerId: 'software-wallet',
            },
        ];
        const vault = {
            addresses: { list: vi.fn(async () => addresses) },
            accounts: { get: vi.fn(async () => ({ walletId: 'device-owner-wallet' })) },
            wallets: { list: vi.fn(async () => [{ id: 'software-wallet' }]) },
        };
        await expect(walletIdForAddress(vault, 'device')).resolves.toBe('device-owner-wallet');
        await expect(walletIdForAddress(vault, 'software')).resolves.toBe('software-wallet');
        expect(vault.accounts.get).toHaveBeenCalledOnce();
        expect(vault.accounts.get).toHaveBeenCalledWith('device-account');
    });
});
