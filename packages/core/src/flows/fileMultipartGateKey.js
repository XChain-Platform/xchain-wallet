// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { resolveGatedPackKey } from './gatedPackKey.js';
import { gateMinAmountValidationError } from './gatedPublishAction.js';
import { resolveGateMinAmountActive } from './protocolActivations.js';
import { indexerWatermark } from './balances.js';

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

async function freshGate(gate, { chainId, sdkRegistry, gateMinAmountHeights }) {
    const ticker = typeof gate.ticker === 'string' ? gate.ticker.trim().toUpperCase() : '';
    if (!ticker) refuse('GATED_TICKER_INVALID', 'Gate ticker is required.');
    const minAmount = String(gate.minAmount ?? '').trim();
    if (!minAmount) return { ticker, minAmount };
    const thresholdError = gateMinAmountValidationError(minAmount);
    if (thresholdError) refuse('GATE_MIN_AMOUNT_INVALID', thresholdError);
    const active = await resolveGateMinAmountActive({
        chainId,
        heights: gateMinAmountHeights,
        getBlockHeight: async () => {
            const { watermark } = await indexerWatermark({ sdkRegistry, chainId });
            return watermark;
        },
    });
    if (!active) {
        refuse('GATE_MIN_AMOUNT_NOT_ACTIVE', 'Unlock thresholds are not active on this chain yet.');
    }
    return { ticker, minAmount };
}

export async function gatedMultipartRequest(req, deps) {
    if (req?.gate == null) return { ...req };
    assertNoRequestKey(req.gate);
    const { sdk, vault } = deps;
    const gate = req.resumeId
        ? await resumeGate(req, vault)
        : await freshGate(req.gate, { ...deps, chainId: req.chainId });
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
