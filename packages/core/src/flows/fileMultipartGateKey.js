// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveGatedPackKey } from './gatedPackKey.js';

function refuse(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function assertNoRequestKey(gate) {
    if (Object.prototype.hasOwnProperty.call(Object(gate), 'key')
        || Object.prototype.hasOwnProperty.call(Object(gate), 'keyHex')) {
        refuse('FILE_MULTIPART_KEY_IN_REQUEST', 'fileMultipart: gate key bytes are not accepted');
    }
}

async function resumeGate(req, vault) {
    const record = await vault.pendingFileUploads.get(req.resumeId);
    if (!record) {
        refuse('FILE_UPLOAD_NOT_FOUND', `Pending file upload "${req.resumeId}" was not found`);
    }
    if (record.gate == null) {
        refuse('GATED_RESUME_GATE_MISSING', 'Pending file upload has no gate');
    }
    return record.gate;
}

export async function gatedMultipartRequest(req, { sdk, vault }) {
    if (req?.gate == null) return { ...req };
    assertNoRequestKey(req.gate);
    const gate = req.resumeId ? await resumeGate(req, vault) : req.gate;
    const existingKeyHash = req.resumeId ? gate.keyHash : req.existingKeyHash;
    const resolved = await resolveGatedPackKey({
        sdk,
        vault,
        walletId: req.walletId,
        chainId: req.chainId,
        gateTicker: gate.ticker,
        existingKeyHash,
    });
    if (resolved.generatedKey) await vault.gatedKeys.put(resolved.generatedKey);
    const request = {
        ...req,
        gate: { ticker: gate.ticker, minAmount: gate.minAmount, key: resolved.key },
    };
    delete request.existingKeyHash;
    return request;
}
