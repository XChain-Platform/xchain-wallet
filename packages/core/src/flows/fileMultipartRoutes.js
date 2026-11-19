// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { bytesFromLatin1 } from './latin1Bytes.js';
import { gatedMultipartRequest } from './fileMultipartGateKey.js';
import { maxPublicFileBytes } from './fileSizeLimits.js';
import { releaseUploadBlob, releasesUploadBlob } from './uploadBlobRelease.js';

function requireText(value, field, caller) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${caller}: ${field} is required`);
    }
}

function requireBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new Error('handleFileMultipart: bytes (file bytes) are required');
    }
}

function uploadCounts(record) {
    const wavePieces = Array.isArray(record?.wave?.pieces) ? record.wave.pieces : [];
    const currentSent = wavePieces.filter((piece) => piece?.txid);
    const finishedPositions = Math.min(
        Number(record?.wavesDone || 0) * 100,
        Number(record?.totalParts || 0) + 1,
    );
    const finishedParts = Math.max(0, finishedPositions - (finishedPositions > 0 ? 1 : 0));
    const currentIsFinished = record?.wave?.index < Number(record?.wavesDone || 0);
    const currentParts = currentIsFinished
        ? 0
        : currentSent.filter((piece) => piece.index !== -1).length;
    const sentPieces = finishedPositions + (currentIsFinished ? 0 : currentSent.length);
    const fundedWaves = Number(record?.wavesDone || 0)
        + (record?.wave?.fundingTxid && !currentIsFinished ? 1 : 0);
    if (!record?.wave && !Object.hasOwn(record || {}, 'wavesDone')) {
        const sent = Array.isArray(record?.pieces)
            ? record.pieces.filter((piece) => piece?.txid)
            : [];
        return {
            partsSent: sent.filter((piece) => piece.index !== -1).length,
            paidTransactions: (record?.fundingTxid ? 1 : 0) + (2 * sent.length),
        };
    }
    return {
        partsSent: finishedParts + currentParts,
        paidTransactions: fundedWaves + (2 * sentPieces),
    };
}

function pendingUploadSummary(record) {
    return {
        id: record.id,
        name: record.meta?.name ?? '',
        chainId: record.chainId,
        sourceAddress: record.sourceAddress,
        originalSha256: record.originalSha256,
        createdAt: record.createdAt,
        linkTarget: record.linkTarget == null ? null : {
            tick: record.linkTarget.tick,
            issueActionIndex: record.linkTarget.issueActionIndex,
        },
        gated: record.gate !== null,
        ...uploadCounts(record),
        totalParts: record.totalParts,
        stage: record.stage,
    };
}

function routeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requestBytes(req) {
    const hasBytes = req?.bytes !== undefined;
    const hasRawData = req?.rawData !== undefined;
    if (hasBytes && hasRawData) {
        throw routeError(
            'FILE_BYTES_AMBIGUOUS',
            'handleFileMultipart: provide bytes or rawData, not both',
        );
    }
    if (hasRawData) {
        const cap = req?.lane === 'envelope'
            ? maxPublicFileBytes(req.meta ?? {}, { encoding: 'TAPROOT' })
            : (req?.lane === 'standard' ? maxPublicFileBytes(req.meta ?? {}) : null);
        if (Number.isSafeInteger(cap) && typeof req.rawData === 'string'
            && req.rawData.length > cap) {
            throw routeError(
                'FILE_RAW_DATA_TOO_LARGE',
                'handleFileMultipart: rawData exceeds one transaction',
            );
        }
    }
    return hasBytes ? req.bytes : bytesFromLatin1(req?.rawData);
}

async function requestSource(req, deps) {
    const carriesBytes = req?.bytes !== undefined || req?.rawData !== undefined;
    const carriesRef = req?.fileRef !== undefined;
    if (carriesBytes && carriesRef) {
        throw routeError('FILE_SOURCE_AMBIGUOUS', 'handleFileMultipart: provide fileRef or bytes');
    }
    if (!carriesRef) {
        const bytes = requestBytes(req);
        requireBytes(bytes);
        return { bytes, partSource: null };
    }
    if (typeof deps.resolveFileRef !== 'function') {
        throw routeError('FILE_REF_RESOLVER_MISSING', 'handleFileMultipart: file ref resolver is required');
    }
    const partSource = await deps.resolveFileRef(req.fileRef);
    if (!partSource) {
        throw routeError('FILE_REF_MISSING', 'The saved file is unavailable. Choose the file again.');
    }
    return { bytes: null, partSource };
}

function vaultWithFileRef(vault, req) {
    if (!req?.fileRef || !vault?.pendingFileUploads?.put) return vault;
    const collection = vault.pendingFileUploads;
    const wrappedCollection = Object.create(collection);
    wrappedCollection.put = async (record) => {
        if (req.fileRef.kind === 'blob') {
            record.blobKey = req.fileRef.key;
            if (!req.resumeId) record.id = req.fileRef.key;
        } else if (req.fileRef.kind === 'path') {
            record.path = req.fileRef.path;
        }
        return collection.put.call(collection, record);
    };
    const wrappedVault = Object.create(vault);
    Object.defineProperty(wrappedVault, 'pendingFileUploads', { value: wrappedCollection });
    return wrappedVault;
}

async function releaseRequestBlob(req, deps) {
    if (req?.fileRef?.kind !== 'blob') return false;
    return releaseUploadBlob(deps.fileBlobs, req.fileRef.key);
}

function requestCarriesGateKey(req) {
    const gate = Object(req?.gate);
    return Object.prototype.hasOwnProperty.call(gate, 'key')
        || Object.prototype.hasOwnProperty.call(gate, 'keyHex');
}

function multipartReply(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'record')) return result;
    const { record, ...reply } = result;
    if (record == null) return reply;
    const upload = pendingUploadSummary(record);
    return {
        ...reply,
        upload: {
            ...upload,
            keyHash: upload.gated && typeof record.gate?.keyHash === 'string'
                ? record.gate.keyHash
                : null,
        },
    };
}

function multipartSizes(req, deps) {
    if (typeof deps.multipartSizesFor !== 'function') return undefined;
    const sizes = deps.multipartSizesFor(deps.chainRegistry.get(req.chainId));
    if (sizes === null || typeof sizes !== 'object'
        || typeof sizes.envelopePairVbytes !== 'function'
        || typeof sizes.standardPairBytes !== 'function') {
        throw routeError(
            'FILE_MULTIPART_SIZES_INVALID',
            'handleFileMultipart: multipart pair-size estimators are required',
        );
    }
    return sizes;
}

export async function handleFileMultipart(req, deps) {
    requireText(req?.walletId, 'walletId', 'handleFileMultipart');
    requireText(req?.chainId, 'chainId', 'handleFileMultipart');
    requireText(req?.sourceAddress, 'sourceAddress', 'handleFileMultipart');
    const { bytes, partSource } = await requestSource(req, deps);

    const { publishMultipartFile, vault, sdkRegistry, chainRegistry, signer, onBroadcastFailure } = deps;
    const sdk = requestCarriesGateKey(req) ? undefined : sdkRegistry.get(req.chainId);
    const request = await gatedMultipartRequest({
        ...req,
        ...(bytes ? { bytes } : { partSource }),
    }, {
        sdk,
        vault,
        sdkRegistry,
        gateMinAmountHeights: deps.gateMinAmountHeights,
    });
    delete request.rawData;
    delete request.fileRef;
    delete request.outputFloor;
    delete request.sizes;
    const sizes = multipartSizes(req, deps);
    try {
        const result = await publishMultipartFile({
            ...request,
            ...(sizes === undefined ? {} : { sizes }),
            signer,
            vault: vaultWithFileRef(vault, req),
            chainRegistry,
            sdkRegistry,
            onBroadcastFailure,
            waitForTxid: (txid, options) => sdk.waitForAction(txid, options),
        });
        if (releasesUploadBlob(result?.record?.stage)) await releaseRequestBlob(req, deps);
        return multipartReply(result);
    } catch (error) {
        if (error?.code === 'FILE_MULTIPART_MISMATCH') await releaseRequestBlob(req, deps);
        throw error;
    }
}

export async function handleListPendingFileUploads(req, { vault }) {
    requireText(req?.walletId, 'walletId', 'handleListPendingFileUploads');
    // The vault collection API (storage/Vault.js makeCollection): findBy, get, delete.
    const records = await vault.pendingFileUploads.findBy('walletId', req.walletId);
    return { uploads: records.map(pendingUploadSummary) };
}

export async function handleDiscardPendingFileUpload(req, { vault, fileBlobs }) {
    requireText(req?.walletId, 'walletId', 'handleDiscardPendingFileUpload');
    requireText(req?.id, 'id', 'handleDiscardPendingFileUpload');
    const record = await vault.pendingFileUploads.get(req.id);
    if (!record) {
        throw routeError('FILE_UPLOAD_NOT_FOUND', `Pending file upload "${req.id}" was not found`);
    }
    if (record.walletId !== req.walletId) {
        throw routeError('FILE_UPLOAD_WALLET_MISMATCH', 'Pending file upload belongs to another wallet');
    }
    const { paidTransactions } = uploadCounts(record);
    await vault.pendingFileUploads.delete(req.id);
    if (record.blobKey) await releaseUploadBlob(fileBlobs ?? vault.pendingFileBlobs, record.blobKey);
    return { removed: true, paidTransactions };
}
