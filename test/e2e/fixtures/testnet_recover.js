// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import wifCodec from 'wif';
import xchainSdk from 'xchain-sdk';
import { derive, hdKeyFromSeed } from '../../../packages/core/src/crypto/hd.js';
import { bip39MnemonicToSeedSync } from '../../../packages/core/src/crypto/mnemonic.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { TESTNET_NETWORK, liveVenue } from './testnet.js';
import { buildTopUp } from './testnet_topup.js';

const { WalletUtils } = xchainSdk;
const USAGE = 'usage: node test/e2e/fixtures/testnet_recover.js <recovery-wallet.json> <destination> [--broadcast]';

export function recoverKey({ address, phrase } = {}) {
    if (typeof address !== 'string' || typeof phrase !== 'string') {
        throw new Error('recovery record must contain address and phrase');
    }

    const seed = bip39MnemonicToSeedSync(phrase);
    const root = hdKeyFromSeed(seed);
    const wallet = new WalletUtils('bitcoin-testnet');
    try {
        for (const chain of [0, 1]) {
            for (let index = 0; index < 20; index += 1) {
                const path = defaultRegistry().derivationPathFor(
                    'bitcoin-testnet',
                    'p2wpkh',
                    0,
                    chain,
                    index,
                );
                if (!path) throw new Error('testnet p2wpkh derivation is unavailable');
                const key = derive(root, path);
                try {
                    const derivedAddress = wallet.deriveAddress(key.publicKeyHex, { type: 'p2wpkh' });
                    if (derivedAddress === address && key.privateKey) {
                        const privateKey = Buffer.from(key.privateKey);
                        try {
                            return {
                                wif: wifCodec.encode(TESTNET_NETWORK.wif, privateKey, true),
                                address: derivedAddress,
                            };
                        } finally {
                            privateKey.fill(0);
                        }
                    }
                } finally {
                    key.privateKey?.fill(0);
                    key.chainCode?.fill(0);
                }
            }
        }
    } finally {
        seed.fill(0);
    }
    throw new Error('recovery record does not match the derived wallet');
}

async function readRecoveryWallet(filePath) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        if ((stat.mode & 0o077) !== 0) {
            throw new Error('recovery wallet file must grant access only to its owner');
        }
        return recoverKey(JSON.parse(await handle.readFile('utf8')));
    } finally {
        await handle.close();
    }
}

export async function main(
    argv = process.argv.slice(2),
    { venue, stdout = process.stdout, stderr = process.stderr } = {},
) {
    const broadcast = argv.includes('--broadcast');
    const positional = argv.filter((arg) => arg !== '--broadcast');
    if (positional.length < 2) {
        stderr.write(`${USAGE}\n`);
        return 2;
    }

    const source = await readRecoveryWallet(positional[0]);
    const activeVenue = venue ?? liveVenue();
    const view = await activeVenue.utxos(source.address);
    const utxos = Array.isArray(view?.utxos) ? view.utxos : [];
    const tx = buildTopUp({ source, utxos, destination: positional[1] });
    const output = {
        txid: tx.txid,
        txHex: tx.txHex,
        fee: tx.fee,
        swept: tx.swept,
        inputs: tx.inputs,
    };

    if (broadcast) {
        const result = await activeVenue.broadcast(tx.txHex);
        output.broadcastTxid = typeof result === 'string' ? result : (result?.txid ?? result);
    }
    stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
}

function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    try {
        process.exitCode = await main();
    } catch {
        process.stderr.write('testnet recovery refused\n');
        process.exitCode = 1;
    }
}
