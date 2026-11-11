// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { base58check, bech32, bech32m } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { formatNativeBaseUnits } from '../registry/coinTicker.js';
import { nativeFeeTickerFor } from '../registry/nativeFee.js';
import { receiveMultisigAddress } from './multisigAddress.js';
import { startMultisigSigningSession } from './multisigSigning.js';
import {
    buildUnsignedMultisigSpend,
    multisigSighash,
} from './multisigSpend.js';

const bsc = base58check(sha256);
const NO_SINGLE_COIN_MESSAGE = 'No single coin in this multisig covers this amount and fee.';
const TAPROOT_UNAVAILABLE_MESSAGE = 'Sending from a Taproot multisig is not available yet.';

function exactPositiveSats(value, name) {
    let amount;
    try {
        amount = BigInt(value);
    } catch {
        throw new Error(`startMultisigSend: ${name} must be an integer satoshi amount`);
    }
    if (amount <= 0n) throw new Error(`startMultisigSend: ${name} must be positive`);
    return amount;
}

function addressScript(address, network) {
    const value = String(address || '').trim();
    const lower = value.toLowerCase();
    if (network?.bech32 && lower.startsWith(`${network.bech32}1`)) {
        for (const codec of [bech32, bech32m]) {
            try {
                const decoded = codec.decode(lower, 90);
                const version = decoded.words[0];
                const program = codec.fromWords(decoded.words.slice(1));
                const opcode = version === 0 ? 0 : 0x50 + version;
                return `${opcode.toString(16).padStart(2, '0')}${program.length.toString(16).padStart(2, '0')}`
                    + Array.from(program, (byte) => byte.toString(16).padStart(2, '0')).join('');
            } catch { /* try the checksum variant appropriate to this witness version */ }
        }
    }
    const payload = bsc.decode(value);
    if (payload.length !== 21) throw new Error('startMultisigSend: destination address is invalid');
    const hash = Array.from(payload.slice(1), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (payload[0] === network?.pubKeyHash) return `76a914${hash}88ac`;
    if (payload[0] === network?.scriptHash) return `a914${hash}87`;
    throw new Error('startMultisigSend: destination address is for another network');
}

function compactSizeBytes(value) {
    if (value < 0xfd) return 1;
    if (value <= 0xffff) return 3;
    if (value <= 0xffffffff) return 5;
    return 9;
}

/**
 * Price the exact output scripts with maximum 73-byte DER signatures. A
 * typical 2-of-3 payment to P2PKH plus change is 193 vB for P2WSH: 128 base
 * bytes and 256 witness bytes. Bare P2SH is 386 bytes because its 256-byte
 * unlocking script receives no witness discount. Removing P2WSH change makes
 * the same transaction 150 vB; removing P2SH change makes it 343 bytes.
 */
export function estimateMultisigSpendVsize({ scheme, script, threshold, outputScripts }) {
    const scriptBytes = script.length / 2;
    const outputBytes = outputScripts.reduce(
        (total, output) => total + 8 + compactSizeBytes(output.length / 2) + output.length / 2,
        0,
    );
    const common = 4 + 1 + 1 + outputBytes + 4;
    if (scheme === 'p2sh-multisig') {
        const scriptPushBytes = scriptBytes <= 75 ? 1 : scriptBytes <= 255 ? 2 : 3;
        const scriptSigBytes = 1 + threshold * 74 + scriptPushBytes + scriptBytes;
        return common + 36 + compactSizeBytes(scriptSigBytes) + scriptSigBytes + 4;
    }
    if (scheme === 'p2wsh-multisig') {
        const baseBytes = common + 36 + 1 + 4;
        const witnessBytes = 1 + 1 + threshold * 74 + compactSizeBytes(scriptBytes) + scriptBytes;
        return Math.ceil((baseBytes * 4 + 2 + witnessBytes) / 4);
    }
    throw new Error(`startMultisigSend: unsupported scheme "${scheme}"`);
}

function feeFor(rate, vsize) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
    if (!match) throw new Error('startMultisigSend: feeRate must be a non-negative sat/vB rate');
    const scale = 10n ** BigInt((match[2] || '').length);
    const numerator = BigInt(match[1]) * scale + BigInt(match[2] || '0');
    if (numerator <= 0n) throw new Error('startMultisigSend: feeRate must be positive');
    return (numerator * BigInt(vsize) + scale - 1n) / scale;
}

function normalizedUtxos(result) {
    const rows = Array.isArray(result) ? result : Array.isArray(result?.utxos) ? result.utxos : [];
    return rows.map((row) => ({
        txid: String(row.txid || row.tx_hash || row.txHash || ''),
        vout: Number(row.vout ?? row.tx_pos ?? row.outputIndex),
        value: exactPositiveSats(row.value ?? row.satoshis ?? row.amount, 'UTXO value'),
        scriptPubKeyHex: String(row.scriptPubKeyHex || row.script || row.scriptPubKey || '').toLowerCase(),
    }));
}

/** Start a single-input native-coin multisig signing session. */
export async function startMultisigSend({
    vault,
    sdkRegistry,
    walletId,
    chainId,
    multisigConfigId,
    destination,
    amountSats,
    feeRate,
}) {
    if (!vault) throw new Error('startMultisigSend: vault is required');
    if (!sdkRegistry) throw new Error('startMultisigSend: sdkRegistry is required');
    const amount = exactPositiveSats(amountSats, 'amountSats');
    const derived = await receiveMultisigAddress({
        vault, sdkRegistry, walletId, chainId, multisigConfigId,
    });
    if (derived.scheme === 'taproot-musig2') throw new Error(TAPROOT_UNAVAILABLE_MESSAGE);
    if (derived.overCeiling || !derived.address) {
        throw new Error('startMultisigSend: this multisig has too many cosigners to spend safely');
    }
    const sdk = sdkRegistry.get(chainId);
    if (!sdk?.encoder || typeof sdk.encoder.getUTXOs !== 'function') {
        throw new Error('startMultisigSend: SDK cannot list multisig coins');
    }
    const network = sdk.wallet?.getBitcoinNetwork?.();
    if (!network) throw new Error('startMultisigSend: SDK has no network parameters');
    const destinationValidation = sdk.validateAddress?.(String(destination || '').trim());
    if (destinationValidation && !destinationValidation.valid) {
        throw new Error('startMultisigSend: destination address is invalid');
    }
    const script = derived.scheme === 'p2wsh-multisig' ? derived.witnessScript : derived.redeemScript;
    const destinationScript = addressScript(destination, network);
    const changeScript = addressScript(derived.address, network);
    const dust = exactPositiveSats(network.dustThreshold, 'dust threshold');
    // Every coin spent here must be locked to this multisig's own script: the
    // witnessUtxo and the sighash commit to it, so a row reporting another
    // script is skipped, and a row that omits the script takes the address's.
    const candidates = normalizedUtxos(await sdk.encoder.getUTXOs(derived.address))
        .map((utxo) => ({ ...utxo, scriptPubKeyHex: utxo.scriptPubKeyHex || changeScript }))
        .filter((utxo) => utxo.scriptPubKeyHex === changeScript)
        .sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : 0);

    let selected = null;
    for (const utxo of candidates) {
        const twoOutputVsize = estimateMultisigSpendVsize({
            scheme: derived.scheme,
            script,
            threshold: derived.threshold,
            outputScripts: [destinationScript, changeScript],
        });
        const twoOutputFee = feeFor(feeRate, twoOutputVsize);
        const change = utxo.value - amount - twoOutputFee;
        if (change > dust) {
            selected = { utxo, fee: twoOutputFee, change };
            break;
        }
        const oneOutputVsize = estimateMultisigSpendVsize({
            scheme: derived.scheme,
            script,
            threshold: derived.threshold,
            outputScripts: [destinationScript],
        });
        const oneOutputFee = feeFor(feeRate, oneOutputVsize);
        if (utxo.value >= amount + oneOutputFee) {
            selected = { utxo, fee: utxo.value - amount, change: 0n };
            break;
        }
    }
    if (!selected) throw new Error(NO_SINGLE_COIN_MESSAGE);

    const outputs = [{ scriptPubKeyHex: destinationScript, value: amount }];
    if (selected.change > 0n) outputs.push({ scriptPubKeyHex: changeScript, value: selected.change });
    const built = buildUnsignedMultisigSpend({
        scheme: derived.scheme,
        script,
        utxo: selected.utxo,
        outputs,
    });
    const msgHash = multisigSighash({
        scheme: derived.scheme,
        script,
        unsignedTxHex: built.unsignedTxHex,
        amount: selected.utxo.value,
    });
    const coin = String(chainId).split('-')[0];
    const ticker = nativeFeeTickerFor(chainId) || coin.toUpperCase();
    const displayAmount = formatNativeBaseUnits(amount, coin) || amount.toString();
    return startMultisigSigningSession({
        vault,
        walletId,
        chainId,
        multisigConfigId,
        msgHash,
        psbtHex: built.psbtHex,
        actionSummary: `Send ${displayAmount} ${ticker} to ${String(destination).trim()}`,
    });
}

export { NO_SINGLE_COIN_MESSAGE, TAPROOT_UNAVAILABLE_MESSAGE };

