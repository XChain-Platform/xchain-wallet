// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { buildTreasuryFunding, outputScriptHex } from '../../e2e/fixtures/testnet.js';
import { fundTestnetAddress } from '../../e2e/fixtures/testnet_funding.js';

const TREASURY = Object.freeze({
    wif: 'cS9nRNmyK8RA5QC7MQAAErJSgR5kmD7mRjpn1TaiDnLqFn4jj3SF',
    address: 'tb1qz2qzsfp5g3g2ez6k4z4x56vuzs3uh3hehhq469',
});
const STRANGER_ADDRESS = 'tb1qzz55z44a8g0er7wtr4ylk74wwcxpve3z63e0tn';
const DESTINATION = 'tb1qmr46t4ca5wh35k6mczdzrkepqw2d8ne9knscsq';
const TREASURY_TXID = 'a'.repeat(64);
const BROADCAST_TXID = 'b'.repeat(64);

function treasuryUtxo() {
    return {
        txid: TREASURY_TXID,
        vout: 0,
        value: '600000',
        confirmations: 3,
        scriptPubKey: outputScriptHex(TREASURY.address),
    };
}

function fakeVenue({ broadcastResult, destinationViews = [], broadcastError } = {}) {
    let destinationRead = 0;
    const broadcast = broadcastError
        ? vi.fn(async () => { throw broadcastError; })
        : vi.fn(async () => broadcastResult);
    const utxos = vi.fn(async (address) => {
        if (address === TREASURY.address) return { utxos: [treasuryUtxo()] };
        if (address === DESTINATION) {
            const view = destinationViews[Math.min(destinationRead, destinationViews.length - 1)];
            destinationRead += 1;
            return typeof view === 'function' ? view() : (view ?? { utxos: [] });
        }
        throw new Error('unexpected venue address');
    });
    return { venue: { utxos, broadcast }, utxos, broadcast };
}

function confirmed(txid) {
    return { utxos: [{ txid, confirmations: 1 }] };
}

describe('testnet funding', () => {
    it('broadcasts the built hex, waits through a third poll, and returns the broadcast txid', async () => {
        const { venue, utxos, broadcast } = fakeVenue({
            broadcastResult: { txid: BROADCAST_TXID },
            destinationViews: [{ utxos: [] }, { utxos: [] }, confirmed(BROADCAST_TXID)],
        });

        const txid = await fundTestnetAddress(venue, TREASURY, DESTINATION, {
            sendSats: 10_000,
            timeoutMs: 10_000,
            sleep: vi.fn(async () => {}),
            now: () => 0,
        });

        expect(txid).toBe(BROADCAST_TXID);
        expect(broadcast).toHaveBeenCalledTimes(1);
        const expected = buildTreasuryFunding({
            treasury: TREASURY,
            utxos: [treasuryUtxo()],
            destination: DESTINATION,
            sendSats: 10_000,
        });
        const [txHex] = broadcast.mock.calls[0];
        expect(broadcast).toHaveBeenCalledWith(expected.txHex);
        expect(bitcoin.Transaction.fromHex(txHex).outs[0].value).toBe(10_000);
        expect(utxos.mock.calls.map(([address]) => address)).toEqual([
            TREASURY.address,
            DESTINATION,
            DESTINATION,
            DESTINATION,
        ]);
    });

    it('returns the built txid when broadcast supplies none', async () => {
        let builtTxid;
        const { venue, broadcast } = fakeVenue({
            broadcastResult: {},
            destinationViews: [() => confirmed(builtTxid)],
        });
        broadcast.mockImplementationOnce(async (txHex) => {
            builtTxid = bitcoin.Transaction.fromHex(txHex).getId();
            return {};
        });

        const returned = await fundTestnetAddress(venue, TREASURY, DESTINATION, {
            sendSats: 10_000,
            timeoutMs: 10_000,
            sleep: vi.fn(async () => {}),
            now: () => 0,
        });
        expect(returned).toBe(builtTxid);
    });

    it('times out when the destination never shows the funding txid', async () => {
        const { venue } = fakeVenue({
            broadcastResult: { txid: BROADCAST_TXID },
            destinationViews: [{ utxos: [] }],
        });
        let time = 0;

        await expect(fundTestnetAddress(venue, TREASURY, DESTINATION, {
            sendSats: 10_000,
            timeoutMs: 2_500,
            sleep: vi.fn(async () => {}),
            now: () => (time += 1_000),
        })).rejects.toThrow(/never observed within 3s/);
    });

    it('refuses a non-testnet destination without deriving a key or calling the venue', async () => {
        const venue = { utxos: vi.fn(), broadcast: vi.fn() };
        const wallet = { importWIF: vi.fn() };
        const invalid = 'bc1qnotatestnetaddress';

        const refusal = await fundTestnetAddress(venue, TREASURY, invalid, { wallet })
            .catch((error) => error);
        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.message).toMatch(/valid Bitcoin testnet destination/);
        expect(refusal.message).not.toContain(invalid);
        expect(wallet.importWIF).not.toHaveBeenCalled();
        expect(venue.utxos).not.toHaveBeenCalled();
        expect(venue.broadcast).not.toHaveBeenCalled();
    });

    it('refuses a key that does not derive its declared address before broadcasting', async () => {
        const { venue, utxos, broadcast } = fakeVenue();

        await expect(fundTestnetAddress(
            venue,
            { wif: TREASURY.wif, address: STRANGER_ADDRESS },
            DESTINATION,
        )).rejects.toThrow(/KEY\/ADDRESS MISMATCH/);
        expect(utxos).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
    });

    it('propagates a broadcast rejection without polling for confirmation', async () => {
        const failure = new Error('broadcast refused');
        const { venue, utxos, broadcast } = fakeVenue({ broadcastError: failure });

        await expect(fundTestnetAddress(venue, TREASURY, DESTINATION, {
            sendSats: 10_000,
        })).rejects.toBe(failure);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(utxos).toHaveBeenCalledTimes(1);
        expect(utxos).toHaveBeenCalledWith(TREASURY.address);
    });
});
