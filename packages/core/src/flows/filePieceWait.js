// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { LEG_NOT_INDEXED, waitForLegIndexed } from './deployLegWait.js';

export const FILE_PIECE_NOT_INDEXED = 'FILE_PIECE_NOT_INDEXED';

const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** @param {any} err */
function filePieceError(err) {
    const message = String(err.message || '')
        .replace('The deploy is saved', 'The upload is saved');
    const adapted = /** @type {Error & { code: string, chainState: string, txid: string }} */ (
        new Error(message)
    );
    adapted.name = 'FilePieceNotIndexedError';
    adapted.code = FILE_PIECE_NOT_INDEXED;
    adapted.chainState = err.chainState;
    adapted.txid = err.txid;
    return adapted;
}

/**
 * @param {object} args
 * @param {(txid: string, opts?: object) => Promise<unknown>} args.waitForTxid
 * @param {any} args.sdk
 * @param {string} args.txid
 * @param {string} args.address
 * @param {string} args.pieceLabel
 * @param {number} [args.patienceMs]
 * @param {(state: object) => void} [args.onChainWait]
 */
export async function waitForFilePieceIndexed({
    waitForTxid, sdk, txid, address, pieceLabel, patienceMs, onChainWait,
}) {
    try {
        return await waitForLegIndexed({
            waitForTxid,
            sdk,
            txid,
            address,
            legLabel: pieceLabel,
            patienceMs,
            onChainWait,
            isChunk: false,
        });
    } catch (err) {
        if (err && err.code === LEG_NOT_INDEXED) throw filePieceError(err);
        throw err;
    }
}

/** @param {any} err */
export function filePieceMayBeOnChain(err) {
    return Boolean(err && err.code === FILE_PIECE_NOT_INDEXED && err.chainState !== 'dropped');
}

/** @param {string} code @param {string|number} fileId @param {any} multipart @param {number} timeoutMs */
function multipartError(code, fileId, multipart, timeoutMs) {
    const detail = code === 'FILE_MULTIPART_MISMATCH'
        ? 'does not match its manifest'
        : `is still pending after ${timeoutMs}ms`;
    const err = /** @type {Error & { code: string, fileId: string, multipart: any }} */ (
        new Error(`Multi-part upload ${fileId} ${detail}.`)
    );
    err.code = code;
    err.fileId = String(fileId);
    err.multipart = multipart;
    return err;
}

/**
 * @param {object} args
 * @param {any} args.sdk
 * @param {string|number} args.fileId
 * @param {(fileId: string|number) => Promise<any>} args.readMultipart
 * @param {number} [args.pollMs]
 * @param {number} [args.timeoutMs]
 * @param {(ms: number) => Promise<void>} [args.sleep]
 */
export async function waitForMultipartComplete({
    sdk,
    fileId,
    readMultipart,
    pollMs = DEFAULT_POLL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sleep = defaultSleep,
}) {
    const interval = Number(pollMs) > 0 ? Number(pollMs) : DEFAULT_POLL_MS;
    const timeout = Number(timeoutMs) >= 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();
    let waitedMs = 0;
    for (;;) {
        const multipart = await readMultipart.call(sdk, fileId);
        if (multipart && multipart.status === 'complete') return multipart;
        if (multipart && multipart.status === 'mismatch') {
            throw multipartError('FILE_MULTIPART_MISMATCH', fileId, multipart, timeout);
        }
        const elapsed = Math.max(waitedMs, Date.now() - startedAt);
        if (elapsed >= timeout) {
            throw multipartError('FILE_MULTIPART_PENDING_TIMEOUT', fileId, multipart, timeout);
        }
        const delay = Math.min(interval, timeout - elapsed);
        await sleep(delay);
        waitedMs = elapsed + delay;
    }
}
