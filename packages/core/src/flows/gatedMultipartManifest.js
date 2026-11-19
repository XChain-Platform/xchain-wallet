// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { composeGatedManifestBatch } from './gatedMultipartBatch.js';

function refuse(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function assertInputs({ key, publicKey, coin, sourceAddress }) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        refuse('GATED_MANIFEST_INPUT_INVALID', 'key must be 32 bytes');
    }
    if (typeof publicKey !== 'string' || !/^[0-9a-f]+$/i.test(publicKey)) {
        refuse('GATED_MANIFEST_INPUT_INVALID', 'publicKey must be a non-empty hex string');
    }
    if (typeof coin !== 'string' || coin.trim().length === 0) {
        refuse('GATED_MANIFEST_INPUT_INVALID', 'coin must be non-empty');
    }
    if (typeof sourceAddress !== 'string' || sourceAddress.trim().length === 0) {
        refuse('GATED_MANIFEST_INPUT_INVALID', 'sourceAddress must be non-empty');
    }
}

/**
 * Build the manifest callback for a gated multipart publish. The encrypted
 * key handoff is composed once and reused when the manifest piece is built.
 */
export function gatedManifestActionData({ sdk, key, publicKey, coin, sourceAddress }) {
    assertInputs({ key, publicKey, coin, sourceAddress });
    const keyBytes = Buffer.from(key);
    const keyHash = bytesToHex(sha256(keyBytes));
    const payload = sdk.gatedFile.serializeKeyPayload([keyBytes]);
    const keyHandoffCiphertext = sdk.messaging.eciesEncryptBytes(payload, publicKey).ciphertext;

    return (manifestParams) => {
        if (manifestParams?.keyHash !== keyHash) {
            refuse('GATED_MANIFEST_KEY_MISMATCH', 'manifest keyHash does not match the gated key');
        }
        return composeGatedManifestBatch({
            manifest: manifestParams,
            keyHandoffCiphertext,
            coin,
            sourceAddress,
        });
    };
}
