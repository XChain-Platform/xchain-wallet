// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Hardware wallet flows: a wallet whose keys live only on a Trezor or Ledger
// (format 'hardware', origin 'connected-hardware'). The record holds no seed,
// no imported keys and no passphrase; its addresses carry the device's
// SignerRecord id and every signature comes from the device.
//
// This module must not import unlockWallet.js or createAccount.js: those
// import HardwareWalletHasNoSeedError from here.

import { createWallet as createWalletRecord } from '../schemas/wallet.js';
import { createSignerRecord, SIGNER_KINDS } from '../schemas/signer.js';
import { createAccount as createAccountRecord } from '../schemas/account.js';
import { createAddress } from '../schemas/address.js';
import { createDefaultSettings } from '../schemas/settings.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { makeFreshKdfParams } from '../crypto/kdf.js';
import { seedSettingsForChains } from './seedSettings.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameKey, nameLength } from '../util/display_name.js';
import { ledgerIdentitiesFromAccounts, withLedgerIdentities } from '../signers/ledgerIdentity.js';
// The format files only, never the signer classes or package index: they hold
// the per-network facts and pull in nothing but core's signed-tx checks.
import { TREZOR_NETWORK_SUPPORT } from '../../../signers-trezor/src/trezorFormat.js';
import { LEDGER_NETWORK_SUPPORT } from '../../../signers-ledger/src/ledgerFormat.js';

/** Raised by any reader that needs a seed when it is handed a hardware wallet. */
export class HardwareWalletHasNoSeedError extends Error {
    constructor(message = 'A hardware wallet has no seed.') {
        super(message);
        this.name = 'HardwareWalletHasNoSeedError';
        this.code = 'HW_NO_SEED';
    }
}

/**
 * True for a wallet record that holds only a device.
 * @param {{format?: string}|null|undefined} wallet
 * @returns {boolean}
 */
export function isHardwareWallet(wallet) {
    return wallet?.format === 'hardware';
}

/**
 * Throw the typed error when a seed reader is handed a hardware wallet.
 * @param {{format?: string, name?: string}|null|undefined} wallet
 * @param {string} [what]   what the caller wanted the seed for, for the message
 */
export function refuseHardwareWallet(wallet, what) {
    if (!isHardwareWallet(wallet)) return;
    const who = wallet.name ? `"${wallet.name}"` : 'This wallet';
    throw new HardwareWalletHasNoSeedError(
        `${who} is a hardware wallet. Its keys stay on your hardware wallet`
        + `${what ? `, so ${what} is not available here` : ''}.`,
    );
}

/**
 * The wallet record when it is a hardware wallet, else null. For flows that
 * must refuse a hardware wallet before their password check; a vault that
 * cannot answer reads as "not hardware" so other wallets keep their errors.
 * @param {any} vault
 * @param {string} walletId
 */
export async function hardwareWalletRecord(vault, walletId) {
    if (!vault?.wallets?.get || typeof walletId !== 'string' || !walletId) return null;
    try {
        const wallet = await vault.wallets.get(walletId);
        return isHardwareWallet(wallet) ? wallet : null;
    } catch {
        return null;
    }
}

// Which chains each vendor's device can sign, per the operator rulings of
// 2026-11-15: mainnet and the test networks wherever the device can, test
// networks at the device's own native derivation (coin type 1'). The facts
// live with the signer packages, in TREZOR_NETWORK_SUPPORT
// (signers-trezor/src/trezorFormat.js) and LEDGER_NETWORK_SUPPORT
// (signers-ledger/src/ledgerFormat.js); this table is their `supported`
// column, built from them so the two can never drift.
// In short: Trezor firmware has no Dogecoin test coin and no Litecoin regtest
// coin; Ledger signs Bitcoin testnet and regtest in its Bitcoin Test app and
// ships no Litecoin or Dogecoin test app.
// This is the one table the connect flow and activateChain read.
const supportedColumn = (table) => Object.freeze(Object.fromEntries(
    Object.entries(table).map(([chainId, row]) => [chainId, row?.supported === true]),
));

export const HARDWARE_NETWORK_SUPPORT = Object.freeze({
    trezor: supportedColumn(TREZOR_NETWORK_SUPPORT),
    ledger: supportedColumn(LEDGER_NETWORK_SUPPORT),
});

const VENDOR_NAMES = Object.freeze({ trezor: 'Trezor', ledger: 'Ledger' });

/**
 * The vendor as the user reads it ("Trezor", "Ledger").
 * @param {string} vendor
 * @returns {string}
 */
export function hardwareVendorName(vendor) {
    const key = String(vendor ?? '');
    if (Object.prototype.hasOwnProperty.call(VENDOR_NAMES, key)) return VENDOR_NAMES[key];
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'this hardware wallet';
}

/**
 * Whether a vendor can sign on a chain, with the one-line reason when it
 * cannot. Unknown vendors and unknown chains are unsupported.
 * @param {string} vendor
 * @param {string} chainId
 * @returns {{supported: boolean, reason: string|null}}
 */
export function hardwareNetworkSupport(vendor, chainId) {
    const table = Object.prototype.hasOwnProperty.call(HARDWARE_NETWORK_SUPPORT, vendor)
        ? HARDWARE_NETWORK_SUPPORT[vendor]
        : null;
    if (table && table[chainId] === true) return { supported: true, reason: null };
    return { supported: false, reason: `Not supported by ${hardwareVendorName(vendor)}` };
}

/** The same device is already connected as another hardware wallet. */
export class HardwareWalletAlreadyLinkedError extends Error {
    constructor(vendor, walletName) {
        super(`This ${hardwareVendorName(vendor)} is already connected as "${walletName}".`);
        this.name = 'HardwareWalletAlreadyLinkedError';
        this.code = 'HW_ALREADY_LINKED';
        this.walletName = walletName;
    }
}

const isNonEmpty = (v) => typeof v === 'string' && v.length > 0;

/**
 * Check the input and resolve every account entry's chain descriptor.
 * Throws on the first problem; nothing is written before this passes.
 */
function validateInput({ vault, chainRegistry, name, device, accounts }) {
    if (!vault) throw new Error('addHardwareWallet: vault is required');
    if (!chainRegistry) throw new Error('addHardwareWallet: chainRegistry is required');
    if (typeof name !== 'string' || !hasVisibleText(name)) {
        throw new Error('addHardwareWallet: name must be a non-empty string');
    }
    if (nameLength(name.trim()) > NAME_MAX_LENGTH) {
        throw new Error(`addHardwareWallet: name must be ${NAME_MAX_LENGTH} characters or fewer`);
    }
    if (!device || typeof device !== 'object') throw new Error('addHardwareWallet: device is required');
    if (!SIGNER_KINDS.includes(device.vendor)) {
        throw new Error(`addHardwareWallet: device.vendor must be one of ${SIGNER_KINDS.join(', ')}`);
    }
    if (!isNonEmpty(device.model)) throw new Error('addHardwareWallet: device.model is required');
    if (!isNonEmpty(device.deviceIdentifier)) {
        throw new Error('addHardwareWallet: device.deviceIdentifier is required');
    }
    if (device.firmwareVersion != null && typeof device.firmwareVersion !== 'string') {
        throw new Error('addHardwareWallet: device.firmwareVersion must be a string');
    }
    if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('addHardwareWallet: accounts must be a non-empty array');
    }
    const seen = new Set();
    return accounts.map((entry, i) => {
        const where = `addHardwareWallet: accounts[${i}]`;
        if (!entry || typeof entry !== 'object') throw new Error(`${where} must be an object`);
        const { chainId, accountIndex, address, publicKey, derivationPath, addressType } = entry;
        if (!isNonEmpty(chainId) || !chainRegistry.has(chainId)) {
            throw new Error(`${where}: unknown chain "${chainId}"`);
        }
        const support = hardwareNetworkSupport(device.vendor, chainId);
        if (!support.supported) throw new Error(`${where}: ${chainId}: ${support.reason}`);
        if (!Number.isInteger(accountIndex) || accountIndex < 0) {
            throw new Error(`${where}: accountIndex must be a non-negative integer`);
        }
        if (!isNonEmpty(address)) throw new Error(`${where}: address is required`);
        if (!isNonEmpty(publicKey)) throw new Error(`${where}: publicKey is required`);
        if (!isNonEmpty(derivationPath) || !derivationPath.startsWith('m/')) {
            throw new Error(`${where}: derivationPath must start with "m/"`);
        }
        const descriptor = chainRegistry.get(chainId);
        if (!isNonEmpty(addressType)
            || (Array.isArray(descriptor?.addressTypes) && !descriptor.addressTypes.includes(addressType))) {
            throw new Error(`${where}: addressType "${addressType}" is not used on ${chainId}`);
        }
        const key = `${chainId}|${accountIndex}`;
        if (seen.has(key)) throw new Error(`${where}: account ${accountIndex} on ${chainId} is listed twice`);
        seen.add(key);
        return { ...entry, descriptor };
    });
}

/**
 * Write every record in one step: Vault.putMany when the vault has it (the
 * real vault, all or nothing), otherwise one put at a time with a reverse
 * rollback on failure.
 */
async function writeAll(vault, entries) {
    if (typeof vault.putMany === 'function') {
        await vault.putMany(entries);
        return;
    }
    const written = [];
    try {
        for (const entry of entries) {
            // eslint-disable-next-line no-await-in-loop
            await entry.store.put(entry.record);
            written.push(entry);
        }
    } catch (error) {
        for (const entry of written.reverse()) {
            if (typeof entry.store.delete !== 'function') continue;
            // eslint-disable-next-line no-await-in-loop
            try { await entry.store.delete(entry.record.id); } catch { /* keep the write error */ }
        }
        throw error;
    }
}

/**
 * Create a hardware wallet with its signer, accounts and addresses.
 *
 * One Account record is written per distinct accountIndex (named
 * "Account N"), and one Address per input entry, with source set to the
 * vendor and signerId set to the new SignerRecord's id. Settings gain the
 * fee entries for the entries' chains; a vault with no settings yet gets a
 * fresh record on the network of the first entry's chain.
 *
 * @param {{vault: object, chainRegistry: object, name: string,
 *   device: {vendor: string, model: string, deviceIdentifier: string, firmwareVersion?: string|null},
 *   accounts: Array<{chainId: string, accountIndex: number, address: string,
 *     publicKey: string, derivationPath: string, addressType: string}>}} input
 * @returns {Promise<{wallet: object, signer: object, accounts: object[],
 *   addresses: Array<{chainId: string, address: object}>}>}
 * @throws {HardwareWalletAlreadyLinkedError} when this device already backs a hardware wallet
 */
export async function addHardwareWallet(input) {
    const { vault, chainRegistry, name, device, accounts } = input ?? {};
    const entries = validateInput({ vault, chainRegistry, name, device, accounts });
    const walletName = name.trim();

    const wallets = await vault.wallets.list();
    if (wallets.some((w) => nameKey(w.name) === nameKey(walletName))) {
        throw new Error(`A wallet named "${walletName}" already exists.`);
    }
    // A device that already backs a hardware wallet would give two wallets
    // the same addresses. Pairing it to a seed wallet as a co-signer does not
    // count: that signer row belongs to a wallet with its own seed.
    const signers = vault.signers ? await vault.signers.list() : [];
    for (const s of signers) {
        if (s.vendor !== device.vendor || s.deviceIdentifier !== device.deviceIdentifier) continue;
        const owner = wallets.find((w) => w.id === s.walletId);
        if (isHardwareWallet(owner)) throw new HardwareWalletAlreadyLinkedError(device.vendor, owner.name);
    }
    // A Ledger's identifier depends on which coin app was open at pairing, so
    // the same device paired from another app also counts when any of its
    // per-chain identities (keys it derived) matches a hardware wallet's.
    const identities = device.vendor === 'ledger' ? ledgerIdentitiesFromAccounts(entries) : null;
    if (identities) {
        const mine = new Set(Object.values(identities).map((entry) => entry.fingerprint));
        const linked = signers.filter((s) => s.vendor === 'ledger'
            && isHardwareWallet(wallets.find((w) => w.id === s.walletId)));
        if (linked.length && mine.size) {
            const stored = vault.addresses ? await vault.addresses.list() : [];
            for (const s of linked) {
                const theirs = withLedgerIdentities(s, stored).identities || {};
                if (Object.values(theirs).some((entry) => mine.has(entry?.fingerprint))) {
                    const owner = wallets.find((w) => w.id === s.walletId);
                    throw new HardwareWalletAlreadyLinkedError(device.vendor, owner.name);
                }
            }
        }
    }

    const wallet = createWalletRecord({
        name: walletName,
        origin: 'connected-hardware',
        format: 'hardware',
        passphraseEnabled: false,
        encryptedSeed: '',
        // Nothing ever opens with it (there is nothing sealed); a valid
        // shape keeps every reader of kdfParams on its normal path.
        kdfParams: makeFreshKdfParams(),
        walletMode: 'full',
    });
    const signer = createSignerRecord({
        walletId: wallet.id,
        kind: device.vendor,
        vendor: device.vendor,
        model: device.model,
        deviceIdentifier: device.deviceIdentifier,
        firmwareVersion: isNonEmpty(device.firmwareVersion) ? device.firmwareVersion : null,
        // A Ledger is recognised on reconnect per chain, through that chain's
        // app (ledgerIdentity.js); a Trezor's device id serves every coin.
        ...(identities && Object.keys(identities).length ? { identities } : {}),
    });

    const accountByIndex = new Map();
    for (const index of [...new Set(entries.map((e) => e.accountIndex))].sort((a, b) => a - b)) {
        accountByIndex.set(index, createAccountRecord({
            walletId: wallet.id,
            name: `Account ${index + 1}`,
            index,
        }));
    }
    const labelCounts = new Map();
    const addresses = entries.map((entry) => {
        const account = accountByIndex.get(entry.accountIndex);
        const countKey = `${account.id}|${entry.chainId}`;
        const n = (labelCounts.get(countKey) ?? 0) + 1;
        labelCounts.set(countKey, n);
        return {
            chainId: entry.chainId,
            address: createAddress({
                accountId: account.id,
                chain: entry.descriptor.coin,
                network: entry.descriptor.networkKind,
                source: device.vendor,
                addressType: entry.addressType,
                derivationPath: entry.derivationPath,
                address: entry.address,
                publicKey: entry.publicKey,
                label: `${tickerForCoin(entry.descriptor.coin)} Address #${n}`,
                signerId: signer.id,
            }),
        };
    });

    const chainIds = [...new Set(entries.map((e) => e.chainId))];
    const existingSettings = await vault.settings.get();
    const baseSettings = existingSettings
        ?? { ...createDefaultSettings(), activeNetwork: entries[0].descriptor.networkKind };
    const settings = seedSettingsForChains(baseSettings, chainRegistry, chainIds);

    const accountRecords = [...accountByIndex.values()];
    await writeAll(vault, [
        { store: vault.settings, record: settings },
        { store: vault.wallets, record: wallet },
        { store: vault.signers, record: signer },
        ...accountRecords.map((record) => ({ store: vault.accounts, record })),
        ...addresses.map(({ address }) => ({ store: vault.addresses, record: address })),
    ]);
    return { wallet, signer, accounts: accountRecords, addresses };
}
