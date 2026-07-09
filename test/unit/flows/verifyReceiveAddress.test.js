// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §17.6 on-demand hardware receive-address confirmation. Re-derives a
// persisted HW address with verify:true (device displays it) and
// cross-checks the device-returned value against the wallet's copy.

import { describe, it, expect } from 'vitest';
import {
    verifyReceiveAddress,
    HardwareAddressMismatchError,
    NotHardwareAddressError,
} from '../../../packages/core/src/flows/verifyReceiveAddress.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
    };
}
function makeVault({ accounts = [], addresses = [] } = {}) {
    return { accounts: memCollection(accounts), addresses: memCollection(addresses) };
}

const BTC = { coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = { get: (id) => (id === 'bitcoin' ? BTC : null) };
const ACCOUNT = { id: 'acct-a', walletId: 'w1', index: 0 };

function hwAddress(overrides = {}) {
    return {
        id: 'addr-1',
        accountId: 'acct-a',
        chain: 'bitcoin',
        network: 'regtest',
        source: 'trezor',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/3",
        address: 'addr_real',
        ...overrides,
    };
}

// Signer that echoes a chosen address on a verify:true derivation.
function makeSigner(deviceAddress) {
    const calls = [];
    return {
        kind: 'trezor',
        calls,
        async getAddresses(params) {
            calls.push(params);
            return [{ index: params.startIndex, address: deviceAddress, publicKey: 'pub', path: 'p' }];
        },
    };
}

describe('verifyReceiveAddress (§17.6)', () => {
    it('confirms when the device echoes the persisted address, requesting verify:true at the right path', async () => {
        const vault = makeVault({ accounts: [ACCOUNT], addresses: [hwAddress()] });
        const signer = makeSigner('addr_real');
        const res = await verifyReceiveAddress({ vault, chainId: 'bitcoin', addressId: 'addr-1', signer, chainRegistry });
        expect(res.confirmed).toBe(true);
        expect(res.deviceAddress).toBe('addr_real');
        expect(signer.calls[0]).toMatchObject({
            chainId: 'bitcoin', accountIndex: 0, change: 0, startIndex: 3, addressType: 'p2wpkh', verify: true,
        });
    });

    it('throws HardwareAddressMismatchError when the device returns a different address', async () => {
        const vault = makeVault({ accounts: [ACCOUNT], addresses: [hwAddress()] });
        const signer = makeSigner('addr_ATTACKER');
        await expect(
            verifyReceiveAddress({ vault, chainId: 'bitcoin', addressId: 'addr-1', signer, chainRegistry }),
        ).rejects.toBeInstanceOf(HardwareAddressMismatchError);
    });

    it('rejects a non-hardware (software) address', async () => {
        const vault = makeVault({ accounts: [ACCOUNT], addresses: [hwAddress({ source: 'hd' })] });
        const signer = makeSigner('addr_real');
        await expect(
            verifyReceiveAddress({ vault, chainId: 'bitcoin', addressId: 'addr-1', signer, chainRegistry }),
        ).rejects.toBeInstanceOf(NotHardwareAddressError);
    });

    it('rejects when chainId does not match the address record', async () => {
        const vault = makeVault({ accounts: [ACCOUNT], addresses: [hwAddress({ network: 'mainnet' })] });
        const signer = makeSigner('addr_real');
        await expect(
            verifyReceiveAddress({ vault, chainId: 'bitcoin', addressId: 'addr-1', signer, chainRegistry }),
        ).rejects.toThrow(/does not match/i);
    });
});
