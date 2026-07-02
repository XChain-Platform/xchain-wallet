// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export {
    parseBip21Uri,
    encodeBip21Uri,
    InvalidBip21Error,
} from './bip21.js';
export { detectQrContent, PSBT_HEX_PREFIX } from './detectQrContent.js';
export {
    parseXchainUri,
    buildXchainUri,
    describeXchainIntent,
} from './xchainUri.js';
export {
    coinCodeForChainId,
    chainIdForCoinCode,
    isKnownCoinCode,
} from './coinCodes.js';
export {
    encodeXcwChunks,
    decodeXcwChunks,
    parseXcwChunk,
    createXcwCollector,
    addChunkToCollector,
    crc32,
    XcwChunkError,
    XCW_PREFIX,
    DEFAULT_CHUNK_BYTES,
} from './psbtQr.js';
export {
    UR_PREFIX,
    UR_PSBT_TYPE,
    UrError,
    UrPsbtDecoder,
    decodeUrPsbt,
    parseUrFrame,
    decodeBytewordsMinimal,
    cborUnwrapBytes,
    chooseFragments,
} from './urPsbt.js';
export {
    ENVELOPE_VERSION as MULTISIG_ENVELOPE_VERSION,
    ENVELOPE_PREFIX as MULTISIG_ENVELOPE_PREFIX,
    MULTISIG_ENVELOPE_KINDS,
    MultisigEnvelopeError,
    fingerprintSessionRef,
    buildRequestEnvelope,
    buildReplyEnvelope,
    buildFinalizedEnvelope,
    validateEnvelope as validateMultisigEnvelope,
    encodeEnvelope as encodeMultisigEnvelope,
    decodeEnvelope as decodeMultisigEnvelope,
} from './multisigPsbtEnvelope.js';
