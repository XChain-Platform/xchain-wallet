// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import wifCodec from 'wif';
import xchainSdk from 'xchain-sdk';
import {
    DEFAULT_FEE_RATE,
    TESTNET_DUST_SATS,
    TESTNET_NETWORK,
    estimateVbytes,
    outputScriptHex,
} from '../../e2e/fixtures/testnet.js';
import { buildTopUp } from '../../e2e/fixtures/testnet_topup.js';

const { WalletUtils } = xchainSdk;
const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);

function generatedKey(type = 'p2wpkh') {
    let privateKey;
    do {
        privateKey = randomBytes(32);
    } while (!ecc.isPrivate(privateKey));
    const publicKey = Buffer.from(ecc.pointFromScalar(privateKey, true));
    const payment = bitcoin.payments[type]({ pubkey: publicKey, network: TESTNET_NETWORK });
    const wif = wifCodec.encode(TESTNET_NETWORK.wif, privateKey, true);
    privateKey.fill(0);
    return { wif, address: payment.address };
}

function utxo(txid, value, source, { confirmations = 3, vout = 0 } = {}) {
    return {
        txid,
        vout,
        value,
        confirmations,
        scriptPubKey: outputScriptHex(source.address),
    };
}

describe('testnet treasury top-up builder', () => {
    it('refuses source and destination address types other than p2wpkh', () => {
        const source = generatedKey();
        const destination = generatedKey();
        const legacySource = generatedKey('p2pkh');
        const legacyDestination = generatedKey('p2pkh');

        expect(() => buildTopUp({
            source: legacySource,
            utxos: [utxo(TXID_A, 50_000, legacySource)],
            destination: destination.address,
        })).toThrow(/source must be a testnet p2wpkh/);
        expect(() => buildTopUp({
            source,
            utxos: [utxo(TXID_A, 50_000, source)],
            destination: legacyDestination.address,
        })).toThrow(/destination must be a testnet p2wpkh/);
    });

    it('proves the source key before reading the UTXO collection', () => {
        const source = generatedKey();
        const stranger = generatedKey();
        let utxosRead = false;
        const args = {
            source: { ...source, address: stranger.address },
            destination: generatedKey().address,
        };
        Object.defineProperty(args, 'utxos', {
            get() {
                utxosRead = true;
                return [];
            },
        });

        expect(() => buildTopUp(args)).toThrow(/KEY\/ADDRESS MISMATCH/);
        expect(utxosRead).toBe(false);
    });

    it('excludes unconfirmed inputs and refuses a confirmed foreign input', () => {
        const source = generatedKey();
        const destination = generatedKey();
        const foreign = generatedKey();
        const wallet = new WalletUtils('bitcoin-testnet');
        const signPsbt = vi.spyOn(wallet, 'signPsbt');

        expect(() => buildTopUp({
            source,
            destination: destination.address,
            wallet,
            utxos: [
                utxo(TXID_A, 100_000, foreign, { confirmations: 0 }),
                utxo(TXID_B, 50_000, source),
                utxo(TXID_C, 50_000, foreign),
            ],
        })).toThrow(/INPUT SCRIPT MISMATCH/);
        expect(signPsbt).not.toHaveBeenCalled();

        expect(() => buildTopUp({
            source,
            destination: destination.address,
            wallet,
            utxos: [utxo(TXID_A, 100_000, foreign, { confirmations: 0 })],
        })).toThrow(/NO CONFIRMED UTXOS/);
    });

    it('names held, needed and shortfall sats when the sweep is at the dust floor', () => {
        const source = generatedKey();
        const destination = generatedKey();
        const fee = estimateVbytes(1, 1) * DEFAULT_FEE_RATE;
        const held = TESTNET_DUST_SATS + fee;
        let error;

        try {
            buildTopUp({
                source,
                destination: destination.address,
                utxos: [utxo(TXID_A, held, source)],
            });
        } catch (caught) {
            error = caught;
        }

        expect(error?.message).toContain(`${held} sats held`);
        expect(error?.message).toContain(`${held + 1} sats needed`);
        expect(error?.message).toContain('shortfall 1 sats');
        expect(error?.message).not.toContain(source.wif);
        expect(error?.message).not.toContain(source.address);
        expect(error?.message).not.toContain(destination.address);
    });

    it('signs every confirmed input into exactly one destination output', () => {
        const source = generatedKey();
        const destination = generatedKey();
        const confirmedTotal = 80_000;
        const expectedFee = estimateVbytes(2, 1) * DEFAULT_FEE_RATE;
        const result = buildTopUp({
            source,
            destination: destination.address,
            utxos: [
                utxo(TXID_A, 90_000, source, { confirmations: 0 }),
                utxo(TXID_B, 50_000, source, { vout: 1 }),
                utxo(TXID_C, 30_000, source, { confirmations: 12, vout: 2 }),
            ],
        });

        const tx = bitcoin.Transaction.fromHex(result.txHex);
        expect(result).toMatchObject({
            txid: tx.getId(),
            fee: expectedFee,
            swept: confirmedTotal - expectedFee,
            inputs: 2,
        });
        expect(tx.ins).toHaveLength(2);
        expect(tx.outs).toHaveLength(1);
        expect(tx.outs[0].value).toBe(confirmedTotal - expectedFee);
        expect(bitcoin.address.fromOutputScript(tx.outs[0].script, TESTNET_NETWORK))
            .toBe(destination.address);
    });
});
