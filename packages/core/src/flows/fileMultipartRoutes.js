// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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

export async function handleFileMultipart(req, deps) {
    requireText(req?.walletId, 'walletId', 'handleFileMultipart');
    requireText(req?.chainId, 'chainId', 'handleFileMultipart');
    requireText(req?.sourceAddress, 'sourceAddress', 'handleFileMultipart');
    requireBytes(req?.bytes);

    const { publishMultipartFile, vault, sdkRegistry, chainRegistry, signer, onBroadcastFailure } = deps;
    const sdk = sdkRegistry.get(req.chainId);
    return publishMultipartFile({
        ...req,
        signer,
        vault,
        chainRegistry,
        sdkRegistry,
        onBroadcastFailure,
        waitForTxid: (txid, options) => sdk.waitForAction(txid, options),
    });
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
