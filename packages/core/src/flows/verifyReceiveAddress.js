// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// verifyReceiveAddress (§17.6 hardware receive-address confirmation).
//
// A hardware wallet's whole point is that the HOST is untrusted: a
// compromised transport (trezord bridge / node-HID / the WebHID popup)
// can return an attacker's receive address while the device derives the
// real one. The only defence that survives a fully-compromised host is
// on-device confirmation: the device displays the address on ITS trusted
// screen and the user compares it to what the wallet shows. This flow
// drives that round-trip for an already-persisted address so the Receive
// screen can offer a "Verify on your device" action, and the address
// generation flow (`receiveAddress`) can confirm a fresh address before
// it is trusted.
//
// The automated `deviceAddress === expected` check here is a secondary
// tripwire (it catches a transport that answers inconsistently across
// calls); the PRIMARY protection is the human comparing the device screen
// to the address the wallet shows. The caller must surface both.

export class HardwareAddressMismatchError extends Error {
    /**
     * @param {{ expected: string, deviceAddress: string, path?: string }} info
     */
    constructor({ expected, deviceAddress, path }) {
        super(
            'Hardware device reported a different address than the wallet holds. '
            + 'Do NOT deposit to this address; disconnect and re-pair the device.',
        );
        this.name = 'HardwareAddressMismatchError';
        this.expected = expected;
        this.deviceAddress = deviceAddress;
        this.path = path;
    }
}

export class NotHardwareAddressError extends Error {
    constructor(source) {
        super(`verifyReceiveAddress: on-device verification is only for hardware addresses (got source "${source}")`);
        this.name = 'NotHardwareAddressError';
        this.source = source;
    }
}

/** BIP44-style path `m / purpose' / coin' / account' / change / index`. */
function parseChangeIndex(derivationPath) {
    if (typeof derivationPath !== 'string') {
        throw new Error('verifyReceiveAddress: address record has no derivationPath');
    }
    const parts = derivationPath.split('/');
    if (parts.length < 2) {
        throw new Error(`verifyReceiveAddress: unparseable derivationPath "${derivationPath}"`);
    }
    const change = Number(parts[parts.length - 2]);
    const index = Number(parts[parts.length - 1]);
    if (!Number.isInteger(change) || !Number.isInteger(index) || index < 0) {
        throw new Error(`verifyReceiveAddress: unparseable derivationPath "${derivationPath}"`);
    }
    return { change, index };
}

/**
 * @typedef {Object} VerifyReceiveAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} chainId
 * @property {string} addressId                  the persisted Address record to confirm
 * @property {import('../signers/Signer.js').Signer} signer   HW signer (RemoteSigner) for this wallet
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 */

/**
 * Confirm a persisted hardware-derived address on the device screen and
 * cross-check the device-returned value against what the wallet holds.
 *
 * @param {VerifyReceiveAddressOpts} opts
 * @returns {Promise<{ confirmed: boolean, deviceAddress: string, expectedAddress: string, path: string }>}
 */
export async function verifyReceiveAddress({
    vault,
    chainId,
    addressId,
    signer,
    chainRegistry,
}) {
    if (!vault) throw new Error('verifyReceiveAddress: vault is required');
    if (typeof addressId !== 'string' || addressId.length === 0) {
        throw new Error('verifyReceiveAddress: addressId is required');
    }
    if (!signer || typeof signer.getAddresses !== 'function') {
        throw new Error('verifyReceiveAddress: a hardware signer is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('verifyReceiveAddress: chainId is required');
    }
    if (!chainRegistry) throw new Error('verifyReceiveAddress: chainRegistry is required');

    const record = await vault.addresses.get(addressId);
    if (!record) {
        throw new Error(`verifyReceiveAddress: no address record "${addressId}"`);
    }
    if (record.source !== 'trezor' && record.source !== 'ledger') {
        throw new NotHardwareAddressError(record.source);
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`verifyReceiveAddress: unknown chain "${chainId}"`);
    if (descriptor.coin !== record.chain || descriptor.networkKind !== record.network) {
        throw new Error('verifyReceiveAddress: chainId does not match the address record');
    }

    const account = (await vault.accounts.list()).find((a) => a.id === record.accountId);
    if (!account) {
        throw new Error(`verifyReceiveAddress: no account "${record.accountId}" for the address`);
    }

    const { change, index } = parseChangeIndex(record.derivationPath);

    const [shown] = await signer.getAddresses({
        chainId,
        accountIndex: account.index,
        change,
        startIndex: index,
        count: 1,
        addressType: record.addressType,
        verify: true,
    });
    const deviceAddress = shown?.address;
    if (typeof deviceAddress !== 'string' || deviceAddress.length === 0) {
        throw new Error('verifyReceiveAddress: device returned no address');
    }
    if (deviceAddress !== record.address) {
        throw new HardwareAddressMismatchError({
            expected: record.address,
            deviceAddress,
            path: record.derivationPath,
        });
    }
    return {
        confirmed: true,
        deviceAddress,
        expectedAddress: record.address,
        path: record.derivationPath,
    };
}
