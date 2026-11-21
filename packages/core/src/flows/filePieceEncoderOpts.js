// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const PIECE_KINDS = new Set(['part', 'manifest']);
const LANES = new Set(['envelope', 'standard']);
const BUILD_MODES = new Set(['one_call', 'two_step']);
const PHASES = new Set(['commit', 'reveal']);
const COMPRESSED_PUBKEY = /^(02|03)[0-9a-fA-F]{64}$/;
const HEX = /^[0-9a-fA-F]+$/;

// The encoder RPC takes rawData as a binary (Latin-1) string and rebuilds the bytes
// with Buffer.from(rawData, 'binary'); a byte array is refused as not a string.
export function binaryStringOf(bytes) {
    if (typeof bytes === 'string') return bytes;
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
}

function invalid(field) {
    const error = new Error(`Invalid file piece encoder field: ${field}`);
    error.code = 'FILE_PIECE_OPTS_INVALID';
    throw error;
}

function validateFundingOutput(fundingOutput) {
    if (!fundingOutput || typeof fundingOutput !== 'object') invalid('fundingOutput');
    for (const field of ['txid', 'vout', 'value', 'scriptPubKey']) {
        if (fundingOutput[field] === undefined || fundingOutput[field] === null) {
            invalid(`fundingOutput.${field}`);
        }
    }
}

function validateRawData(pieceKind, rawData) {
    if (pieceKind === 'manifest') {
        if (rawData !== undefined) invalid('rawData');
        return;
    }
    if (rawData === undefined || rawData === null) invalid('rawData');
    if (rawData.length === 0 || rawData.byteLength === 0) invalid('rawData');
}

function validateSignedCommitHex(phase, signedCommitHex) {
    if (phase !== 'reveal') return;
    if (typeof signedCommitHex !== 'string'
        || signedCommitHex.length === 0
        || signedCommitHex.length % 2 !== 0
        || !HEX.test(signedCommitHex)) invalid('signedCommitHex');
}

function validateArgs(args) {
    const { pieceKind, lane, buildMode, phase, source, fundingOutput, rate, data } = args;
    if (!PIECE_KINDS.has(pieceKind)) invalid('pieceKind');
    if (!LANES.has(lane)) invalid('lane');
    if (!BUILD_MODES.has(buildMode)) invalid('buildMode');
    if (!PHASES.has(phase)) invalid('phase');
    if (lane === 'standard' && buildMode === 'two_step') invalid('buildMode');
    if (!source || source.address === undefined || source.address === null) invalid('source.address');
    if (!COMPRESSED_PUBKEY.test(source.publicKey || '')) invalid('source.publicKey');
    validateFundingOutput(fundingOutput);
    if (!Number.isFinite(rate) || rate <= 0) invalid('rate');
    if (data === undefined) invalid('data');
    validateRawData(pieceKind, args.rawData);
    validateSignedCommitHex(phase, args.signedCommitHex);
}

function envelopeOptions(buildMode, phase, signedCommitHex) {
    // publishMultipartFile refuses non-software signers before a piece is built.
    if (buildMode === 'two_step' && phase === 'reveal') {
        return { envelopeCommitHex: signedCommitHex, signerSupportsTapscript: true };
    }
    return {
        exactInputs: true,
        signerSupportsTapscript: true,
        ...(buildMode === 'two_step' ? { twoStepEnvelope: true } : {}),
    };
}

export function filePieceEncoderOpts(args) {
    validateArgs(args);
    const { pieceKind, lane, buildMode, phase, source, fundingOutput, rate, data } = args;
    return {
        // The encoder selects the source from `pubkey`: an address passes through, while
        // a bare key resolves to the network default type, wrong for a P2PKH owner.
        pubkey: source.address,
        compressedPubKey: source.publicKey,
        sourceAddress: source.address,
        change: source.address,
        utxos: [fundingOutput],
        compress: false,
        feePerKb: rate * 1000,
        data,
        ...(pieceKind === 'part' ? { rawData: binaryStringOf(args.rawData) } : {}),
        encoding: lane === 'envelope' ? 'TAPROOT' : 'P2SH',
        options: lane === 'envelope'
            ? envelopeOptions(buildMode, phase, args.signedCommitHex)
            : { exactInputs: true },
    };
}
