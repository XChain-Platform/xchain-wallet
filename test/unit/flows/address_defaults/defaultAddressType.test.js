// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { COUNTERWALLET_DEFAULT_ADDRESS_TYPE } from '../../../../packages/core/src/crypto/index.js';
import {
    defaultAddressTypeForFormat,
    defaultAddressTypeForWallet,
} from '../../../../packages/core/src/flows/_defaultAddressType.js';

const descriptor = { defaultAddressType: 'p2wpkh' };

describe('defaultAddressTypeForFormat', () => {
    it('uses the Counterwallet default for a legacy wallet', () => {
        expect(defaultAddressTypeForFormat(descriptor, 'counterwallet-legacy'))
            .toBe(COUNTERWALLET_DEFAULT_ADDRESS_TYPE);
    });

    it.each(['bip39', 'wif-only', 'unknown', undefined])(
        'uses the descriptor default for format %s',
        (format) => {
            expect(defaultAddressTypeForFormat(descriptor, format)).toBe('p2wpkh');
        },
    );
});

describe('defaultAddressTypeForWallet', () => {
    it('uses the stored wallet format', async () => {
        const get = vi.fn().mockResolvedValue({ format: 'counterwallet-legacy' });
        const vault = { wallets: { get } };

        await expect(defaultAddressTypeForWallet(vault, 'wallet-1', descriptor))
            .resolves.toBe(COUNTERWALLET_DEFAULT_ADDRESS_TYPE);
        expect(get).toHaveBeenCalledWith('wallet-1');
    });

    it('uses the descriptor default without reading a falsy wallet id', async () => {
        const get = vi.fn();
        const vault = { wallets: { get } };

        await expect(defaultAddressTypeForWallet(vault, '', descriptor))
            .resolves.toBe('p2wpkh');
        expect(get).not.toHaveBeenCalled();
    });

    it('uses the descriptor default when the wallet lookup fails', async () => {
        const get = vi.fn().mockRejectedValue(new Error('unavailable'));
        const vault = { wallets: { get } };

        await expect(defaultAddressTypeForWallet(vault, 'wallet-1', descriptor))
            .resolves.toBe('p2wpkh');
        expect(get).toHaveBeenCalledWith('wallet-1');
    });
});
