// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

function createState() {
    return {
        calls: [],
        mempoolHighWater: 0,
        pieces: [],
        terminals: new Map(),
        nextActionIndex: 0,
        nextTxid: 0,
    };
}

function recordCall(state, method, args) {
    state.calls.push({ method, args });
}

function groupKey(source, fileHash) {
    return `${source}\0${fileHash}`;
}

function confirmedPieces(state, predicate) {
    return state.pieces
        .filter((piece) => piece.state === 'confirmed' && predicate(piece))
        .sort((left, right) => left.actionIndex - right.actionIndex);
}

function validManifest(state, source, fileHash) {
    return confirmedPieces(state, (piece) => piece.kind === 'manifest'
        && piece.source === source && piece.fileHash === fileHash)[0] ?? null;
}

function winningParts(state, manifest) {
    const winners = new Map();
    const candidates = confirmedPieces(state, (piece) => piece.kind === 'part'
        && piece.source === manifest.source && piece.fileHash === manifest.fileHash);
    for (const piece of candidates) {
        const validPosition = Number.isInteger(piece.partIndex)
            && piece.partIndex >= 0 && piece.partIndex < manifest.totalParts;
        if (validPosition && !winners.has(piece.partIndex)) winners.set(piece.partIndex, piece);
    }
    return winners;
}

function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function completionResult(manifest, winners) {
    if (winners.size !== manifest.totalParts) return null;
    const parts = Array.from({ length: manifest.totalParts }, (_, index) => winners.get(index).rawData);
    const digests = parts.map((part) => createHash('sha256').update(part).digest());
    const fileHash = createHash('sha256').update(Buffer.concat(digests)).digest('hex');
    const totalBytes = parts.reduce((sum, part) => sum + part.length, 0);
    return fileHash === manifest.fileHash && totalBytes === manifest.totalBytes
        ? 'complete' : 'mismatch';
}

function settleGroups(state) {
    for (const manifest of confirmedPieces(state, (piece) => piece.kind === 'manifest')) {
        if (validManifest(state, manifest.source, manifest.fileHash) !== manifest) continue;
        const key = groupKey(manifest.source, manifest.fileHash);
        if (state.terminals.has(key)) continue;
        const result = completionResult(manifest, winningParts(state, manifest));
        if (result) state.terminals.set(key, result);
    }
}

function indexPiece(state, piece) {
    piece.actionIndex = state.nextActionIndex;
    state.nextActionIndex += 1;
    piece.state = 'confirmed';
    settleGroups(state);
}

function normalizePiece(state, input) {
    const pieceState = input.state ?? 'mempool';
    if (!['manifest', 'part'].includes(input.kind)) {
        throw new TypeError('kind must be manifest or part');
    }
    if (!['confirmed', 'mempool'].includes(pieceState)) {
        throw new TypeError('state must be confirmed or mempool');
    }
    return {
        kind: input.kind,
        source: input.source,
        fileHash: input.fileHash,
        totalParts: input.totalParts,
        totalBytes: input.totalBytes,
        partIndex: input.partIndex,
        rawData: Uint8Array.from(input.rawData ?? []),
        txid: input.txid ?? `fake-tx-${state.nextTxid++}`,
        state: pieceState,
        actionIndex: null,
    };
}

function copiedPiece(piece) {
    return {
        kind: piece.kind,
        source: piece.source,
        fileHash: piece.fileHash,
        totalParts: piece.totalParts,
        totalBytes: piece.totalBytes,
        partIndex: piece.partIndex,
        rawData: Uint8Array.from(piece.rawData),
        txid: piece.txid,
        state: piece.state,
        actionIndex: piece.state === 'confirmed' ? piece.actionIndex : null,
    };
}

function manifestDetail(state, piece) {
    const manifest = validManifest(state, piece.source, piece.fileHash);
    if (manifest !== piece) {
        return {
            action: 'FILE', action_format: 1, action_index: piece.actionIndex,
            tx_hash: piece.txid, source: piece.source,
            status: 'invalid: FILE_HASH (duplicate manifest)',
        };
    }
    const winners = winningParts(state, piece);
    return {
        action: 'FILE', action_format: 1, action_index: piece.actionIndex,
        tx_hash: piece.txid, source: piece.source, status: 'valid',
        multipart: {
            file_hash: piece.fileHash,
            total_parts: piece.totalParts,
            parts_received: winners.size,
            total_bytes: piece.totalBytes,
            status: state.terminals.get(groupKey(piece.source, piece.fileHash)) ?? 'pending',
        },
    };
}

function partDetail(state, piece) {
    const manifest = validManifest(state, piece.source, piece.fileHash);
    return {
        action: 'FILE', action_format: 2, action_index: piece.actionIndex,
        tx_hash: piece.txid, source: piece.source, status: 'valid',
        file_part: {
            file_hash: piece.fileHash,
            part_index: piece.partIndex,
            manifest_action_index: manifest?.actionIndex ?? null,
        },
    };
}

function detailOf(state, piece) {
    return piece.kind === 'manifest' ? manifestDetail(state, piece) : partDetail(state, piece);
}

function sdkError(status, url, body, rawBody = false) {
    const error = new Error(`Explorer returned HTTP ${status} for ${url}`);
    error.name = 'SDKExplorerError';
    error.code = `EXPLORER_HTTP_${status}`;
    error.details = {
        url,
        status,
        data: rawBody ? new TextEncoder().encode(JSON.stringify(body)) : body,
    };
    return error;
}

function rawRefusal(state, index) {
    const piece = state.pieces.find((item) => item.state === 'confirmed'
        && item.actionIndex === index);
    if (!piece || (piece.kind === 'manifest'
        && validManifest(state, piece.source, piece.fileHash) !== piece)) {
        return { status: 404, body: { error: 'Not found', code: 'NOT_FOUND' } };
    }
    if (piece.kind === 'part') {
        return { status: 404, body: {
            error: 'File parts cannot be served directly', code: 'FILE_PART',
        } };
    }
    const status = state.terminals.get(groupKey(piece.source, piece.fileHash));
    if (status === 'mismatch') return { status: 422, body: {
        error: 'File assembly does not match the manifest', code: 'FILE_ASSEMBLY_MISMATCH',
    } };
    if (status !== 'complete') return { status: 409, body: {
        error: 'File is incomplete', code: 'FILE_INCOMPLETE',
        parts_received: winningParts(state, piece).size, total_parts: piece.totalParts,
    } };
    return null;
}

function createSdk(state) {
    return {
        async getAction(index) {
            recordCall(state, 'getAction', [index]);
            const piece = state.pieces.find((item) => item.state === 'confirmed'
                && item.actionIndex === index);
            if (piece) return { data: [detailOf(state, piece)] };
            if (index < state.nextActionIndex) return { data: [] };
            const body = {
                error: 'This action has not been indexed yet.',
                code: 'ACTION_NOT_YET_INDEXED',
                indexed_through: String(state.nextActionIndex - 1),
            };
            throw sdkError(404, `/action/${index}`, body);
        },
        async getGatedFileRaw(index) {
            recordCall(state, 'getGatedFileRaw', [index]);
            const refusal = rawRefusal(state, index);
            const url = `/file/${index}/raw`;
            if (refusal) throw sdkError(refusal.status, url, refusal.body, true);
            const manifest = state.pieces.find((piece) => piece.state === 'confirmed'
                && piece.actionIndex === index);
            const winners = winningParts(state, manifest);
            const parts = Array.from({ length: manifest.totalParts },
                (_, partIndex) => winners.get(partIndex).rawData);
            return concatBytes(parts);
        },
    };
}

function findPiece(state, txid) {
    return state.pieces.find((piece) => piece.txid === txid);
}

function countMempoolPieces(state) {
    return state.pieces.filter((piece) => piece.state === 'mempool').length;
}

function addStateMethods(api, state) {
    api.addPiece = (input) => {
        recordCall(state, 'addPiece', [input]);
        const piece = normalizePiece(state, input);
        state.pieces.push(piece);
        state.mempoolHighWater = Math.max(state.mempoolHighWater, countMempoolPieces(state));
        if (piece.state === 'confirmed') indexPiece(state, piece);
        return { txid: piece.txid, actionIndex: piece.actionIndex };
    };
    api.mine = () => {
        recordCall(state, 'mine', []);
        for (const piece of state.pieces.filter((item) => item.state === 'mempool')) {
            indexPiece(state, piece);
        }
    };
    api.drop = (txid) => {
        recordCall(state, 'drop', [txid]);
        const piece = findPiece(state, txid);
        if (piece) piece.state = 'dropped';
    };
    api.markUnknown = (txid) => {
        recordCall(state, 'markUnknown', [txid]);
        const piece = findPiece(state, txid);
        if (piece) piece.state = 'unknown';
    };
}

function addQueryMethods(api, state, sdk) {
    api.mempoolCount = () => {
        recordCall(state, 'mempoolCount', []);
        return countMempoolPieces(state);
    };
    api.mempoolHighWater = () => {
        recordCall(state, 'mempoolHighWater', []);
        return state.mempoolHighWater;
    };
    api.txState = (txid) => {
        recordCall(state, 'txState', [txid]);
        return findPiece(state, txid)?.state ?? null;
    };
    api.actionIndexOf = (txid) => {
        recordCall(state, 'actionIndexOf', [txid]);
        const piece = findPiece(state, txid);
        return piece?.state === 'confirmed' ? piece.actionIndex : null;
    };
    api.piecesFor = (source) => {
        recordCall(state, 'piecesFor', [source]);
        return state.pieces.filter((piece) => piece.source === source
            && piece.state !== 'dropped').map(copiedPiece);
    };
    api.sdk = () => sdk;
}

export function createFakeMultipartChain() {
    const state = createState();
    const sdk = createSdk(state);
    const api = { calls: state.calls };
    addStateMethods(api, state);
    addQueryMethods(api, state, sdk);
    return api;
}
