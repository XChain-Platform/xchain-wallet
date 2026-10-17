// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import bitcoin from 'bitcoinjs-lib';
import xchainSdk from 'xchain-sdk';
import {
    DEFAULT_FEE_RATE,
    TESTNET_DUST_SATS,
    TESTNET_NETWORK,
    addressTypeOf,
    assertTreasuryKey,
    estimateVbytes,
    outputScriptHex,
} from './testnet.js';

const { WalletUtils } = xchainSdk;

function requireP2wpkh(role, address) {
    let type;
    try {
        type = addressTypeOf(address);
    } catch {
        throw new Error(`${role} must be a testnet p2wpkh address`);
    }
    if (type !== 'p2wpkh') {
        throw new Error(`${role} must be a testnet p2wpkh address`);
    }
}

/**
 * Build and sign a one-output sweep of every confirmed source UTXO.
 *
 * @param {{ source: { wif: string, address: string }, utxos: any[], destination: string,
 *           feeRate?: number, wallet?: any }} args
 * @returns {{ txHex: string, txid: string, fee: number, swept: number, inputs: number }}
 */
export function buildTopUp(args) {
    const { source, destination, wallet } = args || {};
    const feeRate = args?.feeRate ?? DEFAULT_FEE_RATE;

    requireP2wpkh('source', source?.address);
    requireP2wpkh('destination', destination);
    if (!Number.isFinite(feeRate) || feeRate <= 0) {
        throw new Error('feeRate must be a positive number');
    }

    const signer = wallet ?? new WalletUtils('bitcoin-testnet');
    assertTreasuryKey(source, signer);

    const confirmed = (Array.isArray(args?.utxos) ? args.utxos : [])
        .filter((utxo) => Number(utxo?.confirmations) >= 1);
    if (confirmed.length === 0) {
        throw new Error('NO CONFIRMED UTXOS: nothing available to sweep');
    }

    const sourceScript = outputScriptHex(source.address);
    for (const utxo of confirmed) {
        if (String(utxo?.scriptPubKey || '').toLowerCase() !== sourceScript.toLowerCase()) {
            throw new Error(
                `INPUT SCRIPT MISMATCH: ${utxo?.txid}:${utxo?.vout} does not pay the source; refusing to sign`,
            );
        }
    }

    const held = confirmed.reduce((total, utxo) => total + Number(utxo.value), 0);
    const fee = Math.ceil(estimateVbytes(confirmed.length, 1) * feeRate);
    const swept = held - fee;
    if (swept <= TESTNET_DUST_SATS) {
        const needed = fee + TESTNET_DUST_SATS + 1;
        const shortfall = needed - held;
        throw new Error(
            `INSUFFICIENT SWEEP VALUE: ${held} sats held; ${needed} sats needed; shortfall ${shortfall} sats`,
        );
    }

    const psbt = new bitcoin.Psbt({ network: TESTNET_NETWORK });
    for (const utxo of confirmed) {
        psbt.addInput({
            hash: utxo.txid,
            index: Number(utxo.vout),
            witnessUtxo: { script: Buffer.from(sourceScript, 'hex'), value: Number(utxo.value) },
        });
    }
    psbt.addOutput({ address: destination, value: swept });

    const signed = signer.signPsbt(psbt.toHex(), source.wif);
    if (!signed?.txHex || !signed?.txid) {
        throw new Error('the SDK signer did not finalize the top-up transaction');
    }
    return { txHex: signed.txHex, txid: signed.txid, fee, swept, inputs: confirmed.length };
}
