// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

const DIGEST = /^[0-9a-f]{64}$/;
const IV = /^[0-9a-f]{24}$/;

function field(source, camel, wire, fallback = '') {
    if (source?.[camel] !== undefined && source[camel] !== null) return source[camel];
    if (source?.[wire] !== undefined && source[wire] !== null) return source[wire];
    return fallback;
}

function lowercase(value, fallback) {
    return typeof value === 'string' ? value.toLowerCase() : fallback;
}

function invalid(fieldName, detail) {
    const error = new Error(`${fieldName}: ${detail}`);
    error.code = 'GATED_RECORD_GATE_INVALID';
    error.field = fieldName;
    throw error;
}

export function recordGateOf(gate, plan) {
    if (gate == null) return null;
    const plannedKeyHash = plan?.keyHash ?? plan?.manifestParams?.keyHash;
    return {
        ticker: field(gate, 'ticker', 'GATE_TICKER'),
        minAmount: field(gate, 'minAmount', 'GATE_MIN_AMOUNT'),
        keyHash: lowercase(plannedKeyHash, ''),
        iv: lowercase(plan?.gateIv, null),
    };
}

export function resumeGateOf(recordGate, key) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        invalid('key', 'must be a 32-byte Uint8Array');
    }
    if (typeof recordGate?.keyHash !== 'string' || !DIGEST.test(recordGate.keyHash)) {
        invalid('recordGate.keyHash', 'must be 64 lowercase hex characters');
    }
    if (typeof recordGate?.iv !== 'string' || !IV.test(recordGate.iv)) {
        invalid('recordGate.iv', 'must be 24 lowercase hex characters');
    }
    if (bytesToHex(sha256(key)) !== recordGate.keyHash) {
        const error = new Error('key: sha256 does not match recordGate.keyHash');
        error.code = 'GATED_RESUME_KEY_MISMATCH';
        throw error;
    }
    return {
        ticker: recordGate.ticker,
        minAmount: recordGate.minAmount,
        key,
        iv: recordGate.iv,
    };
}
