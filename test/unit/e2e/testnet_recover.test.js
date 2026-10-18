// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import bitcoin from 'bitcoinjs-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import wifCodec from 'wif';
import xchainSdk from 'xchain-sdk';
import {
    TESTNET_NETWORK,
    assertTreasuryKey,
    outputScriptHex,
} from '../../e2e/fixtures/testnet.js';
import {
    main,
    recoverKey,
    writeRecoveryRecord,
} from '../../e2e/fixtures/testnet_recover.js';

const { WalletUtils } = xchainSdk;
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECOVER_PATH = fileURLToPath(new URL('../../e2e/fixtures/testnet_recover.js', import.meta.url));
const TXID = 'a'.repeat(64);
const tempDirs = [];

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function independentKey(chain, index, phrase = PHRASE) {
    const seed = mnemonicToSeedSync(phrase);
    const child = HDKey.fromMasterSeed(seed).derive(`m/84'/0'/0'/${chain}/${index}`);
    const privateKey = Buffer.from(child.privateKey);
    const publicKey = Buffer.from(child.publicKey);
    const address = bitcoin.payments.p2wpkh({ pubkey: publicKey, network: TESTNET_NETWORK }).address;
    const wif = wifCodec.encode(TESTNET_NETWORK.wif, privateKey, true);
    seed.fill(0);
    privateKey.fill(0);
    return { address, wif };
}

function recoveryFile(address, { mode = 0o600, phrase = PHRASE } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xchain-recover-'));
    tempDirs.push(directory);
    const file = path.join(directory, 'recovery.json');
    fs.writeFileSync(file, JSON.stringify({ address, phrase }), { mode });
    fs.chmodSync(file, mode);
    return file;
}

function capture() {
    let value = '';
    return {
        stream: { write: vi.fn((chunk) => { value += chunk; return true; }) },
        text: () => value,
    };
}

function fakeVenue(source, broadcastResult = { txid: 'broadcast-id' }) {
    return {
        utxos: vi.fn(async () => ({
            utxos: [{
                txid: TXID,
                vout: 0,
                value: 100_000,
                confirmations: 3,
                scriptPubKey: outputScriptHex(source.address),
            }],
        })),
        broadcast: vi.fn(async () => broadcastResult),
    };
}

describe('testnet recovery key derivation', () => {
    it('recovers a receive-chain key and independently derives its p2wpkh address', () => {
        const expected = independentKey(0, 7);
        const recovered = recoverKey({ address: expected.address, phrase: PHRASE });

        expect(recovered).toEqual(expected);
        expect(() => assertTreasuryKey(recovered, new WalletUtils('bitcoin-testnet'))).not.toThrow();
    });

    it('recovers a change-chain key', () => {
        const expected = independentKey(1, 19);

        expect(recoverKey({ address: expected.address, phrase: PHRASE })).toEqual(expected);
    });

    it('refuses an address the phrase does not derive without naming either secret', () => {
        const stranger = independentKey(0, 0);
        const differentPhrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
        let error;

        try {
            recoverKey({ address: stranger.address, phrase: differentPhrase });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).not.toContain(stranger.address);
        for (const word of differentPhrase.split(' ')) expect(error.message).not.toContain(word);
    });
});

describe('testnet recovery CLI', () => {
    it('writes an owner-only record from phrase words that the CLI can sweep', async () => {
        const source = independentKey(0, 9);
        const destination = independentKey(0, 10);
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'xchain-recover-writer-'));
        tempDirs.push(parent);
        const directory = path.join(parent, 'records');
        const file = writeRecoveryRecord(source.address, PHRASE.split(' '), { dir: directory });
        const venue = fakeVenue(source);
        const stdout = capture();

        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        await expect(main([file, destination.address], { venue, stdout: stdout.stream }))
            .resolves.toBe(0);
        const output = JSON.parse(stdout.text());
        const transaction = bitcoin.Transaction.fromHex(output.txHex);

        expect(transaction.outs).toHaveLength(1);
        expect(bitcoin.address.fromOutputScript(transaction.outs[0].script, TESTNET_NETWORK))
            .toBe(destination.address);
        expect(venue.utxos).toHaveBeenCalledOnce();
        expect(venue.broadcast).not.toHaveBeenCalled();
    });

    it('tightens a pre-existing recovery directory and its record', () => {
        const source = independentKey(1, 9);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xchain-recover-writer-'));
        tempDirs.push(directory);
        fs.chmodSync(directory, 0o755);
        const expectedFile = path.join(directory, `stake-unstake-${source.address}.json`);
        fs.writeFileSync(expectedFile, '{}', { mode: 0o644 });
        fs.chmodSync(expectedFile, 0o644);

        const file = writeRecoveryRecord(source.address, PHRASE, { dir: directory });

        expect(file).toBe(expectedFile);
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
            address: source.address,
            phrase: PHRASE,
        });
    });

    it('returns the usage exit when fewer than two positional arguments are given', async () => {
        const stdout = capture();
        const stderr = capture();

        await expect(main(['--broadcast'], { stdout: stdout.stream, stderr: stderr.stream }))
            .resolves.toBe(2);
        expect(stdout.text()).toBe('');
        expect(stderr.text()).toMatch(/^usage: .*\n$/);
        expect(stderr.text().trim().split('\n')).toHaveLength(1);
    });

    it('refuses a recovery file with group or other access before reading UTXOs', async () => {
        const source = independentKey(0, 0);
        const destination = independentKey(0, 1);
        const venue = fakeVenue(source);

        await expect(main(
            [recoveryFile(source.address, { mode: 0o640 }), destination.address],
            { venue },
        )).rejects.toThrow(/only to its owner/);
        expect(venue.utxos).not.toHaveBeenCalled();
        expect(venue.broadcast).not.toHaveBeenCalled();
    });

    it('dry-runs one UTXO read and writes one transaction paying the destination', async () => {
        const source = independentKey(0, 2);
        const destination = independentKey(0, 3);
        const venue = fakeVenue(source);
        const stdout = capture();
        const stderr = capture();

        await expect(main(
            [recoveryFile(source.address), destination.address],
            { venue, stdout: stdout.stream, stderr: stderr.stream },
        )).resolves.toBe(0);
        const lines = stdout.text().trimEnd().split('\n');
        const output = JSON.parse(lines[0]);
        const transaction = bitcoin.Transaction.fromHex(output.txHex);

        expect(lines).toHaveLength(1);
        expect(output).toEqual({
            txid: transaction.getId(),
            txHex: expect.any(String),
            fee: expect.any(Number),
            swept: expect.any(Number),
            inputs: 1,
        });
        expect(bitcoin.address.fromOutputScript(transaction.outs[0].script, TESTNET_NETWORK))
            .toBe(destination.address);
        expect(venue.utxos).toHaveBeenCalledOnce();
        expect(venue.utxos).toHaveBeenCalledWith(source.address);
        expect(venue.broadcast).not.toHaveBeenCalled();
        expect(stderr.text()).toBe('');
        expect(stdout.text()).not.toContain(source.wif);
        for (const word of PHRASE.split(' ')) expect(stdout.text()).not.toContain(word);
    });

    it('broadcasts only when requested and includes the returned transaction id', async () => {
        const source = independentKey(1, 4);
        const destination = independentKey(0, 5);
        const venue = fakeVenue(source);
        const stdout = capture();

        await expect(main(
            [recoveryFile(source.address), destination.address, '--broadcast'],
            { venue, stdout: stdout.stream },
        )).resolves.toBe(0);
        const output = JSON.parse(stdout.text());
        expect(venue.utxos).toHaveBeenCalledOnce();
        expect(venue.broadcast).toHaveBeenCalledOnce();
        expect(venue.broadcast).toHaveBeenCalledWith(output.txHex);
        expect(output.broadcastTxid).toBe('broadcast-id');
    });

    it('reports a direct refusal on one stderr line without the phrase, WIF, or address', () => {
        const differentPhrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
        const source = independentKey(0, 6, differentPhrase);
        const sourceFile = recoveryFile(source.address);
        const destination = independentKey(0, 8);
        const result = spawnSync(process.execPath, [RECOVER_PATH, sourceFile, destination.address], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('testnet recovery refused\n');
        expect(result.stderr).not.toContain(source.wif);
        expect(result.stderr).not.toContain(source.address);
        for (const word of PHRASE.split(' ')) expect(result.stderr).not.toContain(word);
    });
});
