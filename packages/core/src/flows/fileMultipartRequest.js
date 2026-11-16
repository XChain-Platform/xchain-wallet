// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { binaryStringOf } from './filePieceEncoderOpts.js';

const META_FIELDS = ['name', 'type', 'title', 'memo'];
const ISSUE_ACTION_INDEX = /^[1-9]\d*$/;
const EXISTING_KEY_HASH = /^[0-9a-f]{64}$/;

function invalid(field) {
    const error = new Error(`Invalid file multipart request field: ${field}`);
    error.code = 'FILE_MULTIPART_REQUEST_INVALID';
    throw error;
}

function requireText(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) invalid(field);
}

function requestMeta(meta) {
    const result = {};
    for (const field of META_FIELDS) {
        const value = meta?.[field];
        if (value !== undefined && typeof value !== 'string') invalid(`meta.${field}`);
        result[field] = value ?? '';
    }
    return result;
}

function requestLinkTarget(linkTarget) {
    if (linkTarget == null) return null;
    const issueActionIndex = String(linkTarget.issueActionIndex ?? '');
    if (!ISSUE_ACTION_INDEX.test(issueActionIndex)) invalid('linkTarget.issueActionIndex');
    return { tick: linkTarget.tick, issueActionIndex };
}

function hasOwn(value, field) {
    return Object.prototype.hasOwnProperty.call(value, field);
}

function requestGate(gate) {
    if (gate == null) return null;
    const forbidden = ['key', 'keyHex'].find((field) => hasOwn(gate, field));
    if (forbidden) {
        const error = new Error(`File multipart request cannot carry gate.${forbidden}`);
        error.code = 'FILE_MULTIPART_KEY_IN_REQUEST';
        throw error;
    }
    return { ticker: gate.ticker, minAmount: gate.minAmount ?? '' };
}

function validateInputs(args) {
    const { walletId, chainId, from, bytes, path, resumeId, rate, existingKeyHash } = args;
    requireText(walletId, 'walletId');
    requireText(chainId, 'chainId');
    requireText(from?.address, 'from.address');
    requireText(from?.publicKey, 'from.publicKey');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) invalid('bytes');
    if (path?.path !== 'multipart') invalid('path');
    if (resumeId !== undefined) requireText(resumeId, 'resumeId');
    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) invalid('rate');
    if (existingKeyHash !== undefined && !EXISTING_KEY_HASH.test(existingKeyHash)) {
        invalid('existingKeyHash');
    }
    if (existingKeyHash !== undefined && args.gate == null) invalid('existingKeyHash');
}

export function fileMultipartRequest(args = {}) {
    validateInputs(args);
    const {
        walletId, chainId, from, bytes, meta, path, linkTarget, gate,
        resumeId, rate, existingKeyHash,
    } = args;
    return {
        walletId,
        chainId,
        from: { ...from, sourceAddress: from.address },
        rawData: binaryStringOf(bytes),
        meta: requestMeta(meta),
        lane: path.lane,
        buildMode: path.buildMode,
        linkTarget: requestLinkTarget(linkTarget),
        gate: requestGate(gate),
        ...(resumeId !== undefined ? { resumeId } : {}),
        ...(rate !== undefined ? { rate } : {}),
        ...(existingKeyHash !== undefined ? { existingKeyHash } : {}),
    };
}
