// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { binaryStringOf } from './filePieceEncoderOpts.js';
import { assertFileRef } from './fileRefSource.js';

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
    const {
        walletId, chainId, from, bytes, file, fileRef, path, resumeId, rate, existingKeyHash,
    } = args;
    requireText(walletId, 'walletId');
    requireText(chainId, 'chainId');
    requireText(from?.address, 'from.address');
    requireText(from?.publicKey, 'from.publicKey');
    const hasBytes = bytes instanceof Uint8Array && bytes.byteLength > 0;
    const hasFile = Boolean(file && Number.isSafeInteger(file.size) && file.size > 0
        && typeof file.slice === 'function');
    if (!hasBytes && !hasFile) invalid(hasOwn(args, 'file') ? 'file' : 'bytes');
    if (hasBytes && hasFile) invalid('file');
    if (hasFile) assertFileRef(fileRef ?? { kind: 'inline', blob: file });
    if (path?.path !== 'multipart') invalid('path');
    if (resumeId !== undefined) requireText(resumeId, 'resumeId');
    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) invalid('rate');
    if (existingKeyHash !== undefined && !EXISTING_KEY_HASH.test(existingKeyHash)) {
        invalid('existingKeyHash');
    }
    if (existingKeyHash !== undefined && args.gate == null) invalid('existingKeyHash');
}

let extensionBlobStorePromise = null;

function extensionRuntime() {
    return globalThis.chrome?.runtime?.id && typeof globalThis.chrome.runtime.sendMessage === 'function';
}

async function defaultExtensionBlobStore() {
    if (!extensionRuntime()) return null;
    if (!extensionBlobStorePromise) {
        extensionBlobStorePromise = import('../../../extension/src/storage/pendingFileBlobs.js')
            .then(({ createPendingFileBlobs }) => createPendingFileBlobs())
            .catch((error) => {
                extensionBlobStorePromise = null;
                throw error;
            });
    }
    return extensionBlobStorePromise;
}

export async function fileRefFor(file, { blobStore, key } = {}) {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0
        || typeof file.slice !== 'function') {
        invalid('file');
    }
    const store = blobStore === undefined ? await defaultExtensionBlobStore() : blobStore;
    if (store == null) return { kind: 'inline', blob: file };
    if (typeof store.put !== 'function') invalid('blobStore');
    if (typeof key !== 'string' || key.length === 0) invalid('fileRef.key');
    await store.put(key, file);
    return { kind: 'blob', key };
}

function legacyRawData(bytes) {
    return binaryStringOf(bytes);
}

export function fileMultipartRequest(args = {}) {
    validateInputs(args);
    const {
        walletId, chainId, from, bytes, file, fileRef, meta, path, linkTarget, gate,
        resumeId, rate, existingKeyHash,
    } = args;
    return {
        walletId,
        chainId,
        sourceAddress: from.address,
        from: { ...from, sourceAddress: from.address },
        ...(file ? { fileRef: fileRef ?? { kind: 'inline', blob: file } } : {
            rawData: legacyRawData(bytes),
        }),
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
