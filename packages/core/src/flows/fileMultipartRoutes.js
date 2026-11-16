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
    const sent = Array.isArray(record?.pieces)
        ? record.pieces.filter((piece) => piece?.txid)
        : [];
    return {
        partsSent: sent.filter((piece) => piece.index !== -1).length,
        paidTransactions: (record?.fundingTxid ? 1 : 0) + (2 * sent.length),
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
    return hasBytes ? req.bytes : bytesFromLatin1(req?.rawData);
}

function requestCarriesGateKey(req) {
    const gate = Object(req?.gate);
    return Object.prototype.hasOwnProperty.call(gate, 'key')
        || Object.prototype.hasOwnProperty.call(gate, 'keyHex');
}

function multipartReply(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'record')) return result;
    const { record, ...reply } = result;
    return record == null ? reply : { ...reply, upload: pendingUploadSummary(record) };
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
    const bytes = requestBytes(req);
    requireBytes(bytes);

    const { publishMultipartFile, vault, sdkRegistry, chainRegistry, signer, onBroadcastFailure } = deps;
    const sdk = requestCarriesGateKey(req) ? undefined : sdkRegistry.get(req.chainId);
    const request = await gatedMultipartRequest({ ...req, bytes }, {
        sdk,
        vault,
        sdkRegistry,
        gateMinAmountHeights: deps.gateMinAmountHeights,
    });
    delete request.rawData;
    delete request.outputFloor;
    delete request.sizes;
    const sizes = multipartSizes(req, deps);
    const result = await publishMultipartFile({
        ...request,
        ...(sizes === undefined ? {} : { sizes }),
        signer,
        vault,
        chainRegistry,
        sdkRegistry,
        onBroadcastFailure,
        waitForTxid: (txid, options) => sdk.waitForAction(txid, options),
    });
    return multipartReply(result);
}

export async function handleListPendingFileUploads(req, { vault }) {
    requireText(req?.walletId, 'walletId', 'handleListPendingFileUploads');
    const records = await vault.pendingFileUploads.listForWallet(req.walletId);
    return { uploads: records.map(pendingUploadSummary) };
}

export async function handleDiscardPendingFileUpload(req, { vault }) {
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
    await vault.pendingFileUploads.remove(req.id);
    return { removed: true, paidTransactions };
}
