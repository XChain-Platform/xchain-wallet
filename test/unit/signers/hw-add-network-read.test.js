/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Design ruling 2026-11-15: reading a network a Ledger record has no identity
// for yet is accepted the same way the connect flow accepts it (the device
// cannot prove itself in an app it never answered in); the first read records
// that network's identity, and every later read and sign checks it. A sign on
// such a network with the right app open is never told to "open that app": it
// takes the add-network read first (record the identity, then sign).
//
// The pairing factory, LedgerSigner, ensureLive and the session signer are the
// real ones; only the device is a stand-in, and it refuses every path outside
// the open app's coin type as a Ledger does.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import {
    ensureLive, failureKind, isNetworkUnreadError, isWrongAppError, subscribe, cancel,
} from '../../../packages/core/src/signers/hardwareSession.js';
import {
    _resetHardwareReconnectForTests,
    invalidateLiveSigners,
    makeHardwareSessionSigner,
    openHardwareSigner,
    setHardwareRecordSource,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { LEDGER_APP_NAME_FOR_CHAIN } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { SEED_A, SEED_B, seededLedger } from '../../helpers/hwSeedDevice.js';

const REGISTRY = defaultRegistry();
const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const DOGE = 'dogecoin-mainnet';

afterEach(() => {
    _resetHardwareReconnectForTests();
});

function ledgerHolding(mnemonic, openApp) {
    const dev = seededLedger(mnemonic, { openApp });
    const factory = vi.fn(makeLedgerFactory({
        getTransport: async () => dev.transport,
        getAppClass: async () => dev.Btc,
    }));
    return { dev, factory };
}

async function firstAddress(mnemonic, chainId) {
    const { factory } = ledgerHolding(mnemonic, LEDGER_APP_NAME_FOR_CHAIN[chainId]);
    const { signer, pairingInfo } = await factory();
    const [derived] = await signer.getAddresses({
        chainId,
        addressType: REGISTRY.get(chainId).defaultAddressType,
        accountIndex: 0,
        change: 0,
        startIndex: 0,
        count: 1,
    });
    return { derived, pairingInfo };
}

function identityOf(derived) {
    return { path: derived.path, fingerprint: ledgerIdentityFingerprint(derived.publicKey) };
}

/** A Ledger record paired with only the Bitcoin app read: no Litecoin identity yet. */
async function bitcoinOnlyRecord(mnemonic = SEED_A) {
    const { derived, pairingInfo } = await firstAddress(mnemonic, BTC);
    return {
        id: 'sig-ledger',
        walletId: 'hw-1',
        kind: 'ledger',
        vendor: 'ledger',
        model: 'nanoX',
        deviceIdentifier: pairingInfo.deviceIdentifier,
        identities: { [BTC]: identityOf(derived) },
    };
}

/** A session signer whose shell factory can be swapped to another device or app. */
function sessionFor(record, holder) {
    return makeHardwareSessionSigner(record, {
        open: (r, o) => openHardwareSigner(r, { ledger: holder.factory }, o),
    });
}

/** Watch the sign page's events; a failure is cancelled at once so the op rejects. */
function watchFailures() {
    const failures = [];
    const off = subscribe((event) => {
        if (event.type !== 'fail') return;
        failures.push(event.op.failure);
        cancel(event.op.opId);
    });
    return { failures, off };
}

describe('ensureLive with a network the record has no identity for', () => {
    it('lets a read through the app that serves it, and refuses a sign as unread, never as a wrong app', async () => {
        const record = await bitcoinOnlyRecord();
        const { factory } = ledgerHolding(SEED_A, 'Litecoin');

        await expect(ensureLive(record, { ledger: factory }, { chainId: LTC, read: true }))
            .resolves.toMatchObject({ firstRead: true });

        const err = await ensureLive(record, { ledger: factory }, { chainId: LTC }).catch((e) => e);
        expect(err).toMatchObject({ code: 'HW_NETWORK_UNREAD' });
        expect(isWrongAppError(err)).toBe(false);
        expect(failureKind(err)).not.toBe('wrong-app');
        // Across a signer port only the name and message survive.
        expect(isNetworkUnreadError({ name: 'Error', message: err.message })).toBe(true);
    });

    it('still checks a network that has an identity, on a read too: another Ledger is refused', async () => {
        const { derived } = await firstAddress(SEED_A, LTC);
        const record = { ...(await bitcoinOnlyRecord()), identities: { [LTC]: identityOf(derived) } };
        const other = ledgerHolding(SEED_B, 'Litecoin');
        await expect(ensureLive(record, { ledger: other.factory }, { chainId: LTC, read: true }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
        const same = ledgerHolding(SEED_A, 'Litecoin');
        await expect(ensureLive(record, { ledger: same.factory }, { chainId: LTC, read: true }))
            .resolves.not.toHaveProperty('firstRead');
    });

    it('keeps a chain the open app does not serve a wrong app, in words that survive the signer port', async () => {
        const record = await bitcoinOnlyRecord();
        const { factory } = ledgerHolding(SEED_A, 'Litecoin');
        const err = await ensureLive(record, { ledger: factory }, { chainId: DOGE, read: true }).catch((e) => e);
        expect(err).toMatchObject({ code: 'HW_WRONG_APP' });
        expect(isWrongAppError({ name: 'Error', message: err.message })).toBe(true);
    });

    it('leaves a Trezor unchanged: a read gets no pass on another device', async () => {
        const record = { id: 't', vendor: 'trezor', deviceIdentifier: 'dev-1' };
        const trezor = vi.fn(async () => ({ signer: {}, pairingInfo: { deviceIdentifier: 'dev-2' } }));
        await expect(ensureLive(record, { trezor }, { chainId: LTC, read: true }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });
});

describe('the session signer records the first read and checks every later sign', () => {
    it('records the identity from the first address read, then refuses a sign from another Ledger', async () => {
        const record = await bitcoinOnlyRecord();
        const holder = ledgerHolding(SEED_A, 'Litecoin');
        const session = sessionFor(record, holder);

        const [derived] = await session.getAddresses({
            chainId: LTC, addressType: 'p2wpkh', accountIndex: 1, change: 0, startIndex: 0, count: 1,
        });
        expect(session.record.identities[LTC]).toEqual(identityOf(derived));
        expect(session.record.identities[BTC]).toEqual(record.identities[BTC]);

        // After a lock, another Ledger in its Litecoin app is not this one.
        invalidateLiveSigners();
        const other = ledgerHolding(SEED_B, 'Litecoin');
        holder.factory = other.factory;
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
        expect(session.record.identities[LTC]).toEqual(identityOf(derived));

        // The same Ledger signs.
        holder.factory = ledgerHolding(SEED_A, 'Litecoin').factory;
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .resolves.toHaveProperty('signature');
    });

    it('trusts a device taken on a first read only for the network it defined: another network\'s sign checks it again', async () => {
        // The record knows Bitcoin from Ledger A. Ledger B, in its Litecoin
        // app, gives the first Litecoin read (accepted by the ruling), then
        // switches to its Bitcoin app with no lock in between.
        const record = await bitcoinOnlyRecord(SEED_A);
        const holder = ledgerHolding(SEED_B, 'Litecoin');
        const session = sessionFor(record, holder);
        await session.getAddresses({
            chainId: LTC, addressType: 'p2wpkh', accountIndex: 0, change: 0, startIndex: 0, count: 1,
        });
        holder.dev.device.openApp = 'Bitcoin';
        const { derived } = await firstAddress(SEED_A, BTC);
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: BTC }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
        expect(holder.factory).toHaveBeenCalledTimes(2);
    });

    it('a read of a network with no identity re-reads the record first, and is checked when the host holds one', async () => {
        const record = await bitcoinOnlyRecord();
        const { derived } = await firstAddress(SEED_A, LTC);
        setHardwareRecordSource(async () => ({ ...record, identities: { ...record.identities, [LTC]: identityOf(derived) } }));
        const session = sessionFor(record, ledgerHolding(SEED_B, 'Litecoin'));
        await expect(session.getAddresses({
            chainId: LTC, addressType: 'p2wpkh', accountIndex: 0, change: 0, startIndex: 0, count: 1,
        })).rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });

    it('never reuses a device taken unchecked for a read to sign: the sign opens it again', async () => {
        const record = await bitcoinOnlyRecord();
        const holder = ledgerHolding(SEED_A, 'Litecoin');
        const session = sessionFor(record, holder);
        const { derived } = await firstAddress(SEED_A, LTC);

        await session.getPublicKey({ chainId: LTC, path: derived.path });
        expect(holder.factory).toHaveBeenCalledTimes(1);
        // A public-key read names no account, so it records nothing.
        expect(session.record.identities[LTC]).toBeUndefined();

        const { failures, off } = watchFailures();
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .resolves.toHaveProperty('signature');
        off();
        expect(holder.factory).toHaveBeenCalledTimes(2);
        expect(failures).toEqual([]);
    });
});

describe('a sign on a network the record has no identity for, with its app open', () => {
    it('re-reads the record first and signs against the identity it holds, with no failure shown', async () => {
        const record = await bitcoinOnlyRecord();
        const { derived } = await firstAddress(SEED_A, LTC);
        const source = vi.fn(async (id) => ({ ...record, id, identities: { ...record.identities, [LTC]: identityOf(derived) } }));
        setHardwareRecordSource(source);
        const holder = ledgerHolding(SEED_A, 'Litecoin');
        const session = sessionFor(record, holder);

        const { failures, off } = watchFailures();
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .resolves.toHaveProperty('signature');
        off();
        expect(source).toHaveBeenCalledWith(record.id);
        expect(failures).toEqual([]);
        expect(session.record.identities[LTC]).toEqual(identityOf(derived));
    });

    it('refuses another Ledger once the re-read record names the network', async () => {
        const record = await bitcoinOnlyRecord();
        const { derived } = await firstAddress(SEED_A, LTC);
        setHardwareRecordSource(async () => ({ ...record, identities: { ...record.identities, [LTC]: identityOf(derived) } }));
        const session = sessionFor(record, ledgerHolding(SEED_B, 'Litecoin'));
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });

    it('with no newer record, takes the add-network read at the key it signs with, records it, then signs', async () => {
        const record = await bitcoinOnlyRecord();
        const { derived } = await firstAddress(SEED_A, LTC);
        const holder = ledgerHolding(SEED_A, 'Litecoin');
        const session = sessionFor(record, holder);

        const { failures, off } = watchFailures();
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .resolves.toHaveProperty('signature');
        off();
        expect(failures).toEqual([]);
        expect(session.record.identities[LTC]).toEqual(identityOf(derived));

        // Recorded: from here a sign from another Ledger is refused.
        invalidateLiveSigners();
        holder.factory = ledgerHolding(SEED_B, 'Litecoin').factory;
        await expect(session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });

    it('a sign whose app is not open still names the app it needs', async () => {
        const record = await bitcoinOnlyRecord();
        const { derived } = await firstAddress(SEED_A, LTC);
        const session = sessionFor(record, ledgerHolding(SEED_A, 'Dogecoin'));
        const err = await session.signMessage({ message: 'hi', path: derived.path, chainId: LTC }).catch((e) => e);
        expect(failureKind(err)).toBe('wrong-app');
    });
});
