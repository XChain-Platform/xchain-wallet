// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createGatedKey, gatedKeyId } from '../schemas/gatedKey.js';

function refuse(code, field, message) {
    const error = new Error(`${field}: ${message}`);
    error.code = code;
    throw error;
}

function validateInput({ walletId, chainId, gateTicker, existingKeyHash, vault }) {
    for (const [field, value] of Object.entries({ walletId, chainId, gateTicker })) {
        if (typeof value !== 'string' || value.trim() === '') {
            refuse('GATED_PACK_KEY_INPUT_INVALID', field, 'must be a non-empty string');
        }
    }
    if (existingKeyHash !== undefined
        && (typeof existingKeyHash !== 'string' || !/^[0-9a-f]{64}$/.test(existingKeyHash))) {
        refuse('GATED_PACK_KEY_INPUT_INVALID', 'existingKeyHash', 'must be 64 lowercase hex characters');
    }
    if (existingKeyHash !== undefined && typeof vault?.gatedKeys?.get !== 'function') {
        refuse('GATED_PACK_KEY_INPUT_INVALID', 'vault.gatedKeys.get', 'must be a function');
    }
}

/** Resolve a new or stored gated pack key without persisting it. */
export async function resolveGatedPackKey({
    sdk,
    vault,
    walletId,
    chainId,
    gateTicker,
    existingKeyHash,
}) {
    validateInput({ walletId, chainId, gateTicker, existingKeyHash, vault });
    if (existingKeyHash !== undefined) {
        const id = gatedKeyId({ walletId, chainId, gateTicker, keyHash: existingKeyHash });
        const record = await vault.gatedKeys.get(id);
        if (!record) refuse('GATED_PACK_KEY_MISSING', 'existingKeyHash', 'stored key was not found');
        const key = Buffer.from(record.keyHex, 'hex');
        if (!sdk.gatedFile.verifyKey(key, record.keyHash)) {
            refuse('GATED_PACK_KEY_HASH_MISMATCH', 'existingKeyHash', 'stored key fails its hash check');
        }
        return { key, keyHash: record.keyHash.toLowerCase(), generatedKey: null };
    }
    const generated = sdk.gatedFile.generateKey();
    const key = Buffer.from(generated.key);
    const keyHash = generated.keyHash.toLowerCase();
    const generatedKey = createGatedKey({
        walletId,
        chainId,
        gateTicker,
        keyHash,
        keyHex: key.toString('hex'),
        source: 'published',
    });
    return { key, keyHash, generatedKey };
}
