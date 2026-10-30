// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Does every signature in a transaction this wallet is about to broadcast, but
// did not just sign with its own software key, verify against the coin it
// spends?
//
// Three routes hand the wallet signed bytes it did not produce: a raw signed
// transaction pasted on the Broadcast screen, a signed PSBT brought back from a
// watcher and signer pair, and a multisig transaction finalized from cosigner
// signatures or pasted from another coordinator. A signature that does not
// verify reaches the node, which refuses it, and the user is left holding a
// transaction that can never confirm. Device replies get the same check inside
// the Trezor and Ledger signers (verifyInputSignatures.js); this module is the
// one check for the other routes, run right before the broadcast.
//
// Prevouts. A signature commits to the script and, for segwit and taproot, the
// amount of the coin it spends, so the check needs both for every input:
//   - from the PSBT the wallet holds (prevoutsFromPsbt), when it holds one;
//   - otherwise from the UTXO tracker (prevoutsFromTracker): the input's
//     spending data names its key or script, which gives the address, whose
//     unspent outputs must list the outpoint with that script. Script and amount
//     are taken from the tracker, never from the pasted bytes.
// An input whose prevout cannot be established is refused, the same as an
// input whose signature fails.
//
// Scope. Every check uses SIGHASH_ALL (and SIGHASH_DEFAULT for taproot), the
// only types the wallet's own signers and cosigners emit:
//   - p2pkh, p2wpkh, p2sh-p2wpkh: as verifyInputSignatures.js checks them.
//   - p2sh, p2wsh and p2sh-p2wsh m-of-n OP_CHECKMULTISIG: each signature must
//     verify against a later key than the one before it, in script order, as
//     the interpreter matches them, under the legacy hash (p2sh) or the BIP143
//     hash with the witness script as scriptCode.
//   - p2tr key path: the BIP341 signature hash over every input's amount and
//     script, verified with BIP340 against the output key.
// Script-path spends, an annex, any other sighash type and any other script are
// refused as unverifiable. Litecoin and Dogecoin use these same hashes.
//
// Cost: the BIP143 and BIP341 whole-transaction hashes are computed once, so a
// segwit or taproot input costs one short hash and one verify; a legacy input
// rehashes the transaction, as in verifyInputSignatures.js.

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32, createBase58check } from '@scure/base';
import { readSignedRawTx } from './verifySignedTx.js';
import {
    SignatureMismatchError,
    bip143Digester,
    bytesToHex,
    checkSignature,
    exactSats,
    hash160,
    hexToBytes,
    isPubkey,
    legacyDigest,
    outpoint,
    p2pkhScript,
    serializeOutputs,
    uintLE,
    varSlice,
} from './verifyInputSignatures.js';

const SIGHASH_ALL = 0x01;
const SIGHASH_DEFAULT = 0x00;
const OP_CHECKMULTISIG = 0xae;

/**
 * @typedef {Object} Prevout
 * @property {string} prevTxHash        display-order txid of the coin spent
 * @property {number} prevTxIndex
 * @property {string} scriptPubKeyHex   the coin's script
 * @property {number|string|bigint|null} value  the coin's amount in satoshis
 * @property {number|null} [sighashType]        the type a PSBT input requests
 */

function sha256Hex(hex) {
    return bytesToHex(sha256(hexToBytes(hex)));
}

function taggedHash(tag, hex) {
    const tagHash = bytesToHex(sha256(new TextEncoder().encode(tag)));
    return sha256(hexToBytes(tagHash + tagHash + hex));
}

/**
 * The items of a script made only of data pushes, with OP_0 read as an empty
 * item, or null when it holds any other opcode or runs off the end.
 */
function pushItems(hex) {
    const items = [];
    const len = hex.length / 2;
    const byteAt = (p) => parseInt(hex.slice(p * 2, p * 2 + 2), 16);
    let pos = 0;
    while (pos < len) {
        const op = byteAt(pos);
        pos += 1;
        let size;
        if (op === 0x00) {
            size = 0;
        } else if (op <= 0x4b) {
            size = op;
        } else if (op === 0x4c && pos + 1 <= len) {
            size = byteAt(pos);
            pos += 1;
        } else if (op === 0x4d && pos + 2 <= len) {
            size = byteAt(pos) | (byteAt(pos + 1) << 8);
            pos += 2;
        } else {
            return null;
        }
        if (pos + size > len) return null;
        items.push(hex.slice(pos * 2, (pos + size) * 2));
        pos += size;
    }
    return items;
}

/**
 * The threshold and keys of a bare `OP_m <key>... OP_n OP_CHECKMULTISIG`
 * script, or null for any other script.
 */
export function parseMultisigScript(hex) {
    const len = hex.length / 2;
    const byteAt = (p) => parseInt(hex.slice(p * 2, p * 2 + 2), 16);
    if (len < 3 || byteAt(len - 1) !== OP_CHECKMULTISIG) return null;
    const m = byteAt(0) - 0x50;
    const n = byteAt(len - 2) - 0x50;
    if (m < 1 || m > 16 || n < m || n > 16) return null;
    const keys = pushItems(hex.slice(2, (len - 2) * 2));
    if (!keys || keys.length !== n || !keys.every(isPubkey)) return null;
    return { m, keys };
}

/**
 * Check `items` (the dummy, then the signatures) against a multisig script the
 * way OP_CHECKMULTISIG matches them. Returns a reason, or null when they verify.
 */
function checkMultisig(items, scriptHex, digestFor, wantSighash) {
    const multisig = parseMultisigScript(scriptHex);
    if (!multisig) return 'the script is not a bare multisig script';
    const { m, keys } = multisig;
    if (!items || items.length !== m + 1) return `the spend does not carry ${m} signature(s) after the dummy`;
    if (items[0] !== '') return 'the multisig dummy element is not empty';
    let digest = null;
    const cachedDigest = () => {
        if (!digest) digest = digestFor();
        return digest;
    };
    let k = 0;
    for (let s = 1; s <= m; s++) {
        let matched = false;
        let lastReason = 'no key is left to match the signature';
        while (k < keys.length && !matched) {
            const reason = checkSignature(items[s], keys[k], cachedDigest, wantSighash);
            k += 1;
            if (reason === null) matched = true;
            else lastReason = reason;
        }
        if (!matched) return `signature ${s} does not verify against any remaining key (${lastReason})`;
    }
    return null;
}

/** The BIP341 key-path SIGHASH_DEFAULT / SIGHASH_ALL digest builder. */
function bip341Digester(tx, amounts, scripts) {
    const shaPrevouts = sha256Hex(tx.inputs.map(outpoint).join(''));
    const shaAmounts = sha256Hex(amounts.map((a) => uintLE(a, 8)).join(''));
    const shaScripts = sha256Hex(scripts.map(varSlice).join(''));
    const shaSequences = sha256Hex(tx.inputs.map((input) => uintLE(input.sequence, 4)).join(''));
    const shaOutputs = sha256Hex(serializeOutputs(tx.outputs));
    return (index, hashType) => taggedHash('TapSighash', `00${uintLE(hashType, 1)}`
        + uintLE(tx.version >>> 0, 4) + uintLE(tx.locktime, 4)
        + shaPrevouts + shaAmounts + shaScripts + shaSequences + shaOutputs
        + `00${uintLE(index, 4)}`);
}

/**
 * Refuse a signed transaction when any input's signature fails to verify
 * against its prevout, or the prevouts are not the coins it spends.
 *
 * @param {Object} params
 * @param {string} params.txHex
 * @param {Prevout[]} params.prevouts      one per input, in input order
 * @param {string} params.signerId         names the route in the error
 * @throws {SignatureMismatchError}
 */
export function assertTxSignaturesVerify({ txHex, prevouts, signerId }) {
    let tx;
    let signatures;
    try {
        ({ tx, signatures } = readSignedRawTx(txHex));
    } catch (err) {
        throw new SignatureMismatchError(signerId, `the transaction could not be decoded (${err.message})`);
    }
    if (!Array.isArray(prevouts) || prevouts.length !== tx.inputs.length) {
        throw new SignatureMismatchError(signerId, 'the prevouts do not cover every input');
    }
    const scripts = prevouts.map((p) => String(p?.scriptPubKeyHex || '').toLowerCase());
    const amounts = prevouts.map((p) => exactSats(p?.value));
    let bip143 = null;
    let bip341 = null;
    for (let i = 0; i < tx.inputs.length; i++) {
        const fail = (reason) => new SignatureMismatchError(signerId, `input ${i}: ${reason}`);
        const want = prevouts[i];
        const got = tx.inputs[i];
        if (String(want.prevTxHash || '').toLowerCase() !== got.prevTxHash || Number(want.prevTxIndex) !== got.prevTxIndex) {
            throw fail(`it spends ${got.prevTxHash}:${got.prevTxIndex}, the prevout is ${want.prevTxHash}:${want.prevTxIndex}`);
        }
        const script = scripts[i];
        const amount = amounts[i];
        const { scriptSigHex, witness } = signatures[i];
        const requested = want.sighashType === null || want.sighashType === undefined ? null : Number(want.sighashType);
        const ecdsaSighash = requested ?? SIGHASH_ALL;
        const segwitDigest = (scriptCode) => {
            if (amount === null) throw fail('the prevout carries no exact amount');
            if (!bip143) bip143 = bip143Digester(tx);
            return () => bip143(i, scriptCode, amount);
        };
        const checkWitnessMultisig = (witnessScript) => {
            if (witness.length < 2) throw fail('the witness does not end in a witness script');
            if (witness[witness.length - 1] !== witnessScript) throw fail('the witness script is not the one the prevout commits to');
            const reason = checkMultisig(witness.slice(0, -1), witnessScript, segwitDigest(witnessScript), ecdsaSighash);
            if (reason) throw fail(reason);
        };
        const checkWitnessKey = (keyHash) => {
            if (witness.length !== 2) throw fail('the witness is not <signature> <pubkey>');
            const [sigHex, pubkeyHex] = witness;
            if (pubkeyHex.length !== 66 || !isPubkey(pubkeyHex) || hash160(pubkeyHex) !== keyHash) {
                throw fail('the public key does not own the prevout');
            }
            const reason = checkSignature(sigHex, pubkeyHex, segwitDigest(p2pkhScript(keyHash)), ecdsaSighash);
            if (reason) throw fail(reason);
        };

        let m;
        if ((m = /^76a914([0-9a-f]{40})88ac$/.exec(script))) {
            const pushes = pushItems(scriptSigHex);
            if (!pushes || pushes.length !== 2) throw fail('the scriptSig is not <signature> <pubkey>');
            if (witness.some((item) => item.length > 0)) throw fail('a p2pkh input carries a witness');
            const [sigHex, pubkeyHex] = pushes;
            if (!isPubkey(pubkeyHex) || hash160(pubkeyHex) !== m[1]) throw fail('the public key does not own the prevout');
            const reason = checkSignature(sigHex, pubkeyHex, () => legacyDigest(tx, i, script), ecdsaSighash);
            if (reason) throw fail(reason);
        } else if ((m = /^0014([0-9a-f]{40})$/.exec(script))) {
            if (scriptSigHex.length !== 0) throw fail('a p2wpkh input carries a scriptSig');
            checkWitnessKey(m[1]);
        } else if ((m = /^0020([0-9a-f]{64})$/.exec(script))) {
            if (scriptSigHex.length !== 0) throw fail('a p2wsh input carries a scriptSig');
            const witnessScript = witness[witness.length - 1] ?? '';
            if (sha256Hex(witnessScript) !== m[1]) throw fail('the witness script does not match the prevout');
            checkWitnessMultisig(witnessScript);
        } else if ((m = /^a914([0-9a-f]{40})87$/.exec(script))) {
            const pushes = pushItems(scriptSigHex);
            if (!pushes || pushes.length === 0) throw fail('the scriptSig does not end in a redeem script');
            const redeem = pushes[pushes.length - 1];
            if (hash160(redeem) !== m[1]) throw fail('the redeem script does not match the prevout');
            let inner;
            if ((inner = /^0014([0-9a-f]{40})$/.exec(redeem))) {
                if (pushes.length !== 1) throw fail('the scriptSig is not the redeem script push');
                checkWitnessKey(inner[1]);
            } else if ((inner = /^0020([0-9a-f]{64})$/.exec(redeem))) {
                if (pushes.length !== 1) throw fail('the scriptSig is not the redeem script push');
                const witnessScript = witness[witness.length - 1] ?? '';
                if (sha256Hex(witnessScript) !== inner[1]) throw fail('the witness script does not match the redeem script');
                checkWitnessMultisig(witnessScript);
            } else {
                if (witness.some((item) => item.length > 0)) throw fail('a p2sh input carries a witness');
                const reason = checkMultisig(pushes.slice(0, -1), redeem, () => legacyDigest(tx, i, redeem), ecdsaSighash);
                if (reason) throw fail(reason);
            }
        } else if ((m = /^5120([0-9a-f]{64})$/.exec(script))) {
            if (scriptSigHex.length !== 0) throw fail('a p2tr input carries a scriptSig');
            if (witness.length !== 1) throw fail('only a key-path spend with no annex can be verified');
            const sigHex = witness[0];
            if (sigHex.length !== 128 && sigHex.length !== 130) throw fail('the signature is not 64 or 65 bytes');
            const hashType = sigHex.length === 130 ? parseInt(sigHex.slice(128), 16) : SIGHASH_DEFAULT;
            if (sigHex.length === 130 && hashType !== SIGHASH_ALL) {
                throw fail(`sighash type 0x${hashType.toString(16)} cannot be checked`);
            }
            if (requested !== null && requested !== SIGHASH_DEFAULT && requested !== SIGHASH_ALL) {
                throw fail(`the PSBT asked for sighash type 0x${requested.toString(16)}, which cannot be checked`);
            }
            if (amounts.some((a) => a === null) || scripts.some((s) => s.length === 0)) {
                throw fail('a taproot signature commits to every prevout, and one carries no exact amount or script');
            }
            if (!bip341) bip341 = bip341Digester(tx, amounts, scripts);
            let ok = false;
            try {
                ok = schnorr.verify(hexToBytes(sigHex.slice(0, 128)), bip341(i, hashType), hexToBytes(m[1]));
            } catch {
                ok = false;
            }
            if (!ok) throw fail('the signature does not verify for this input');
        } else {
            throw fail('this script type cannot be verified');
        }
    }
}

/**
 * The prevouts a decomposed PSBT records, in input order.
 *
 * @param {import('./types.js').DecomposedPsbt} decomposed
 * @returns {Prevout[]}
 */
export function prevoutsFromPsbt(decomposed) {
    return (decomposed?.inputs || []).map((input) => ({
        prevTxHash: input.prevTxHash,
        prevTxIndex: input.prevTxIndex,
        scriptPubKeyHex: input.scriptPubKeyHex || input.witnessUtxoScriptHex || '',
        value: input.value,
        sighashType: input.sighashType,
    }));
}

/**
 * The script and address-encoding of the coin an input spends, read from its
 * spending data, or null when the data names no key or script that gives one.
 */
function spentScriptOf(scriptSigHex, witness) {
    const pushes = pushItems(scriptSigHex);
    if (!pushes) return null;
    const hasWitness = witness.length > 0;
    if (!hasWitness && pushes.length === 2 && isPubkey(pushes[1])) {
        const h = hash160(pushes[1]);
        return { script: `76a914${h}88ac`, kind: 'base58', version: 'pubKeyHash', program: h };
    }
    if (!hasWitness && pushes.length >= 3 && pushes[0] === '' && parseMultisigScript(pushes[pushes.length - 1])) {
        const h = hash160(pushes[pushes.length - 1]);
        return { script: `a914${h}87`, kind: 'base58', version: 'scriptHash', program: h };
    }
    const keyWitness = witness.length === 2 && witness[1].length === 66 && isPubkey(witness[1]);
    const scriptWitness = witness.length >= 3 && witness[0] === '' && parseMultisigScript(witness[witness.length - 1]);
    let program = null;
    if (keyWitness) program = `0014${hash160(witness[1])}`;
    else if (scriptWitness) program = `0020${sha256Hex(witness[witness.length - 1])}`;
    if (!program) return null;
    if (pushes.length === 0) {
        return { script: program, kind: 'bech32', version: 0, program: program.slice(4) };
    }
    if (pushes.length === 1 && pushes[0] === program) {
        const h = hash160(program);
        return { script: `a914${h}87`, kind: 'base58', version: 'scriptHash', program: h };
    }
    return null;
}

/**
 * Encode the address of a spent script under the chain's network parameters
 * (the bitcoinjs network shape: `bech32`, `pubKeyHash`, `scriptHash`), or null
 * when the network cannot encode it.
 */
function addressOf(spent, network) {
    if (spent.kind === 'bech32') {
        if (typeof network?.bech32 !== 'string' || network.bech32.length === 0) return null;
        return bech32.encode(network.bech32, [spent.version, ...bech32.toWords(hexToBytes(spent.program))]);
    }
    const version = network?.[spent.version];
    if (!Number.isInteger(version) || version < 0 || version > 0xff) return null;
    return createBase58check(sha256).encode(hexToBytes(uintLE(version, 1) + spent.program));
}

/**
 * Establish every input's prevout from the UTXO tracker. Each input's spending
 * data gives the address of the coin it spends; that address's unspent outputs
 * must list the outpoint, with the script the spending data commits to. The
 * tracker's amount is the one used. One tracker read per distinct address.
 *
 * @param {Object} params
 * @param {string} params.txHex
 * @param {(address: string) => Promise<any>} params.getUtxos     encoder.getUTXOs
 * @param {{ bech32?: string, pubKeyHash?: number, scriptHash?: number }} params.network
 * @param {string} params.signerId
 * @returns {Promise<Prevout[]>}
 * @throws {SignatureMismatchError} when any input's prevout cannot be established
 */
export async function prevoutsFromTracker({ txHex, getUtxos, network, signerId }) {
    let tx;
    let signatures;
    try {
        ({ tx, signatures } = readSignedRawTx(txHex));
    } catch (err) {
        throw new SignatureMismatchError(signerId, `the transaction could not be decoded (${err.message})`);
    }
    if (typeof getUtxos !== 'function') {
        throw new SignatureMismatchError(signerId, 'no UTXO source can report the coins this transaction spends');
    }
    const plan = tx.inputs.map((input, i) => {
        const spent = spentScriptOf(signatures[i].scriptSigHex, signatures[i].witness);
        const address = spent ? addressOf(spent, network) : null;
        if (!address) {
            throw new SignatureMismatchError(signerId, `input ${i}: its spending data names no address whose coins can be looked up`);
        }
        return { input, spent, address };
    });
    const byAddress = new Map();
    for (const { address } of plan) {
        if (byAddress.has(address)) continue;
        let rows;
        try {
            const res = await getUtxos(address);
            rows = Array.isArray(res) ? res : res?.utxos;
        } catch (err) {
            throw new SignatureMismatchError(signerId, `the coins of ${address} could not be read (${err?.message || err})`);
        }
        byAddress.set(address, Array.isArray(rows) ? rows : []);
    }
    return plan.map(({ input, spent, address }, i) => {
        const row = byAddress.get(address).find((r) => String(r?.txid || '').toLowerCase() === input.prevTxHash
            && Number(r?.vout) === input.prevTxIndex);
        if (!row) {
            throw new SignatureMismatchError(signerId, `input ${i}: ${address} lists no unspent ${input.prevTxHash}:${input.prevTxIndex}`);
        }
        const reported = String(row.scriptPubKey || '').toLowerCase();
        if (reported !== spent.script) {
            throw new SignatureMismatchError(signerId, `input ${i}: the tracker reports script ${reported}, the spend commits to ${spent.script}`);
        }
        const value = exactSats(row.value);
        if (value === null) throw new SignatureMismatchError(signerId, `input ${i}: the tracker reports no exact amount`);
        return { prevTxHash: input.prevTxHash, prevTxIndex: input.prevTxIndex, scriptPubKeyHex: reported, value, sighashType: null };
    });
}

/**
 * The one check before a route broadcasts a transaction the wallet's software
 * signer did not just produce. Verifies against the PSBT when one is held and
 * decomposes, otherwise against the prevouts the UTXO tracker reports.
 *
 * @param {Object} params
 * @param {any} params.sdk                  the chain's SDK (wallet + encoder)
 * @param {string} params.txHex
 * @param {string|null} [params.psbtHex]    the PSBT the transaction finalizes, when held
 * @param {string} params.signerId          names the route in the error
 * @throws {SignatureMismatchError}
 */
export async function assertBroadcastSignaturesVerify({ sdk, txHex, psbtHex = null, signerId }) {
    let decomposed = null;
    if (typeof psbtHex === 'string' && psbtHex.length > 0 && typeof sdk?.wallet?.decomposePsbt === 'function') {
        try {
            decomposed = sdk.wallet.decomposePsbt(psbtHex);
        } catch {
            decomposed = null;
        }
    }
    const prevouts = decomposed && Array.isArray(decomposed.inputs)
        ? prevoutsFromPsbt(decomposed)
        : await prevoutsFromTracker({
            txHex,
            getUtxos: typeof sdk?.encoder?.getUTXOs === 'function' ? (address) => sdk.encoder.getUTXOs(address) : null,
            network: typeof sdk?.wallet?.getBitcoinNetwork === 'function' ? sdk.wallet.getBitcoinNetwork() : null,
            signerId,
        });
    assertTxSignaturesVerify({ txHex, prevouts, signerId });
}
