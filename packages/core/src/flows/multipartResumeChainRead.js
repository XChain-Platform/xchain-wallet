// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { inclusionOf, utxoListOf } from './txInclusionProbe.js';
import { checkInputLiveness } from './inputLiveness.js';

export const RESUME_CHAIN_READ_INVALID = 'RESUME_CHAIN_READ_INVALID';

const lower = (value) => String(value || '').trim().toLowerCase();

function invalid(field) {
    const error = new Error(`Cannot read resume chain state: ${field} is invalid`);
    error.code = RESUME_CHAIN_READ_INVALID;
    return error;
}

function validate(record, address) {
    if (!record || typeof record !== 'object') throw invalid('record');
    if (typeof address !== 'string' || address.trim().length === 0) throw invalid('address');
    const wave = record.wave ?? record;
    if (!Array.isArray(wave.fundingOutputs)) throw invalid('fundingOutputs');
    if (!Array.isArray(wave.pieces)) throw invalid('pieces');
}

function recordTxids(record) {
    const wave = record.wave ?? record;
    const txids = [];
    const add = (txid) => {
        if (typeof txid === 'string' && txid.length > 0 && !txids.includes(txid)) txids.push(txid);
    };
    add(wave.fundingTxid);
    for (const piece of wave.pieces) {
        for (const txid of Array.isArray(piece?.signedTxids) ? piece.signedTxids : []) add(txid);
        add(piece?.txid);
    }
    return txids;
}

async function readAddressState(sdk, address) {
    const result = { utxos: null, unconfirmed: null };
    const getUTXOs = sdk?.encoder?.getUTXOs;
    const getUnconfirmed = sdk?.getUnconfirmed;
    await Promise.all([
        typeof getUTXOs === 'function' && Promise.resolve().then(() => getUTXOs.call(sdk.encoder, address))
            .then((value) => { result.utxos = utxoListOf(value); }).catch(() => {}),
        typeof getUnconfirmed === 'function' && Promise.resolve().then(() => getUnconfirmed.call(sdk, address))
            .then((value) => { result.unconfirmed = Array.isArray(value) ? value : null; }).catch(() => {}),
    ]);
    return result;
}

async function readBlocks(sdk, txids) {
    const getTxBlock = sdk?.encoder?.getTxBlock;
    if (typeof getTxBlock !== 'function') return new Map();
    const entries = await Promise.all(txids.map(async (txid) => {
        try {
            return [txid, { answered: true, included: Boolean(inclusionOf(
                await getTxBlock.call(sdk.encoder, txid),
            )) }];
        } catch {
            return [txid, { answered: false, included: false }];
        }
    }));
    return new Map(entries);
}

function statusOf(txid, blocks, addressState, hasReadSurface) {
    if (!hasReadSurface) return null;
    const block = blocks.get(txid);
    if (block?.included) return 'confirmed';
    const wanted = lower(txid);
    const own = (addressState.utxos || []).filter((utxo) => utxo && lower(utxo.txid) === wanted);
    if (own.some((utxo) => Number(utxo.confirmations) >= 1)) return 'confirmed';
    if (own.length > 0) return 'mempool';
    if ((addressState.unconfirmed || []).some((row) => row && lower(row.tx_hash) === wanted)) {
        return 'mempool';
    }
    const mempoolAnswered = addressState.utxos !== null || addressState.unconfirmed !== null;
    return block?.answered && mempoolAnswered ? 'dropped' : 'unknown';
}

function markFundingOutputs(record, address, addressState) {
    const wave = record.wave ?? record;
    const utxosByAddress = addressState.utxos === null ? {} : { [address]: addressState.utxos };
    return wave.fundingOutputs.map((output) => {
        const result = checkInputLiveness({
            inputs: [{
                prevTxHash: output?.txid,
                prevTxIndex: output?.vout,
                address,
            }],
            utxosByAddress,
        });
        return { ...output, unspent: result.verdict === 'live' };
    });
}

export async function readResumeChainState({ sdk, record, address } = {}) {
    validate(record, address);
    const txids = recordTxids(record);
    const canBlock = typeof sdk?.encoder?.getTxBlock === 'function';
    const canUtxos = typeof sdk?.encoder?.getUTXOs === 'function';
    const canUnconfirmed = typeof sdk?.getUnconfirmed === 'function';
    const [blocks, addressState] = await Promise.all([
        readBlocks(sdk, txids),
        readAddressState(sdk, address),
    ]);
    const chainStates = {};
    for (const txid of txids) {
        chainStates[txid] = statusOf(
            txid, blocks, addressState, canBlock || canUtxos || canUnconfirmed,
        );
    }
    const fundingOutputs = markFundingOutputs(record, address, addressState);
    const nextRecord = record.wave
        ? { ...record, wave: { ...record.wave, fundingOutputs } }
        : { ...record, fundingOutputs };
    return {
        chainStates,
        record: nextRecord,
    };
}
