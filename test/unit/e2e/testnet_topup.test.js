// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { buildTopUp, main } from '../../e2e/fixtures/testnet_topup.js';

const { WalletUtils } = xchainSdk;
const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);
const TOP_UP_PATH = fileURLToPath(new URL('../../e2e/fixtures/testnet_topup.js', import.meta.url));
const tempDirs = [];

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

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

function walletFile(source, { mode = 0o600, alias = false } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xchain-topup-'));
    tempDirs.push(directory);
    const file = path.join(directory, 'source.json');
    const stored = alias
        ? { wif: source.wif, segwitAddress: source.address }
        : source;
    fs.writeFileSync(file, JSON.stringify(stored), { mode });
    fs.chmodSync(file, mode);
    return file;
}

function capture() {
    let text = '';
    return {
        stream: { write: vi.fn((chunk) => { text += chunk; return true; }) },
        text: () => text,
    };
}

function fakeVenue(source, txid = TXID_A) {
    return {
        utxos: vi.fn(async () => ({ utxos: [utxo(txid, 100_000, source)] })),
        broadcast: vi.fn(async () => ({ txid: 'broadcast-id' })),
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

describe('testnet treasury top-up CLI', () => {
    it('returns the usage exit when fewer than two positional arguments are given', async () => {
        const stdout = capture();
        const stderr = capture();

        await expect(main(['--broadcast'], { stdout: stdout.stream, stderr: stderr.stream }))
            .resolves.toBe(2);
        expect(stdout.text()).toBe('');
        expect(stderr.text()).toMatch(/^usage: .*\n$/);
        expect(stderr.text().trim().split('\n')).toHaveLength(1);
    });

    it('refuses a source wallet file with group or other access', async () => {
        const source = generatedKey();
        const destination = generatedKey();
        const venue = fakeVenue(source);

        await expect(main([walletFile(source, { mode: 0o640 }), destination.address], { venue }))
            .rejects.toThrow(/only to its owner/);
        expect(venue.utxos).not.toHaveBeenCalled();
        expect(venue.broadcast).not.toHaveBeenCalled();
    });

    it('accepts segwitAddress as the stored source address alias', async () => {
        const source = generatedKey();
        const destination = generatedKey();
        const venue = fakeVenue(source);
        const stdout = capture();

        await expect(main(
            [walletFile(source, { alias: true }), destination.address],
            { venue, stdout: stdout.stream },
        )).resolves.toBe(0);
        expect(venue.utxos).toHaveBeenCalledOnce();
        expect(venue.utxos).toHaveBeenCalledWith(source.address);
        expect(JSON.parse(stdout.text())).not.toHaveProperty('broadcastTxid');
    });

    it('writes one dry-run JSON line whose txid matches the decoded transaction', async () => {
        const source = generatedKey();
        const destination = generatedKey();
        const venue = fakeVenue(source);
        const stdout = capture();

        await expect(main(
            [walletFile(source), destination.address],
            { venue, stdout: stdout.stream },
        )).resolves.toBe(0);
        const lines = stdout.text().trimEnd().split('\n');
        const output = JSON.parse(lines[0]);
        expect(lines).toHaveLength(1);
        expect(output).toEqual({
            txid: bitcoin.Transaction.fromHex(output.txHex).getId(),
            txHex: expect.any(String),
            fee: expect.any(Number),
            swept: expect.any(Number),
            inputs: 1,
        });
        expect(venue.utxos).toHaveBeenCalledOnce();
        expect(venue.broadcast).not.toHaveBeenCalled();
    });

    it('broadcasts only when requested and includes the returned transaction id', async () => {
        const source = generatedKey();
        const destination = generatedKey();
        const venue = fakeVenue(source);
        const stdout = capture();

        await expect(main(
            [walletFile(source), destination.address, '--broadcast'],
            { venue, stdout: stdout.stream },
        )).resolves.toBe(0);
        const output = JSON.parse(stdout.text());
        expect(venue.broadcast).toHaveBeenCalledOnce();
        expect(venue.broadcast).toHaveBeenCalledWith(output.txHex);
        expect(output.broadcastTxid).toBe('broadcast-id');
    });

    it('reports a direct refusal on one stderr line without the key or either address', () => {
        const source = generatedKey();
        const destination = generatedKey();
        const sourceFile = path.join(
            os.tmpdir(),
            `${source.wif}-${source.address}-${destination.address}.json`,
        );
        const result = spawnSync(process.execPath, [
            TOP_UP_PATH,
            sourceFile,
            destination.address,
        ], { encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('testnet top-up refused\n');
        expect(result.stderr).not.toContain(source.wif);
        expect(result.stderr).not.toContain(source.address);
        expect(result.stderr).not.toContain(destination.address);
    });
});
