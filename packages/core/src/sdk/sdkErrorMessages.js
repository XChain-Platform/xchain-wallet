// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const GROUPS = [
    ['SDKActionError', [
        'ACTION_REJECTED', 'ACTION_STATUS_UNKNOWN', 'CARRIER_ACTION_MISMATCH', 'CARRIER_BIND_MISSING_ACTION',
        'CARRIER_UNREADABLE', 'COMPRESSION_BYTES_UNREPORTED', 'CONFIRMATION_TIMEOUT',
        'CONTRACT_BALANCE_TIMEOUT', 'CONTRACT_STATE_TIMEOUT', 'CROSS_CHAIN_PARTIAL_FAILURE',
        'CROSS_CHAIN_WAIT_PARTIAL_FAILURE', 'ENVELOPE_REVEAL_BROADCAST_FAILED', 'FEE_OVER_CAP',
        'FULL_BURN_FEE', 'MALFORMED_FEE_CAP', 'MALFORMED_PHASE_FUNDING_CAP', 'NEGATIVE_FEE',
        'NO_SIGNER_OWNED_INPUT', 'OP_RETURN_CARRIES_VALUE', 'OUTPUT_OVER_REQUESTED_VALUE',
        'PHASE_FUNDING_OVER_CAP', 'PHASE_FUNDING_UNSPENT', 'SIGNER_ENCODING_UNSUPPORTED',
        'UNRECONCILABLE_PSBT', 'UNRECONCILED_OUTPUT',
    ], 'The action could not be completed. Check its status and try again.'],
    ['SDKAuthError', [
        'INVALID_ADDRESS', 'INVALID_MESSAGE', 'INVALID_WIF', 'NETWORK_NOT_CONFIGURED',
        'SEGWIT_NOT_SUPPORTED', 'SIGN_FAILED',
    ], 'The wallet could not authorize this request. Check the account details and try again.'],
    ['SDKCompressionError', [
        'COMPRESS_FAILED', 'INPUT_TOO_LARGE', 'INVALID_ACTION', 'INVALID_INPUT', 'NOT_A_FILE_ACTION',
    ], 'The file could not be compressed for this action. Choose a smaller file and try again.'],
    ['SDKConfigError', [
        'CHAIN_NOT_CONFIGURED', 'ENCODER_NOT_CONFIGURED', 'EXPLORER_NOT_CONFIGURED', 'HUB_NOT_CONFIGURED',
        'INVALID_SDK_MAP', 'MISSING_CONTRACT_INDEX', 'MISSING_CONTRACT_STATE_CONDITION',
        'MISSING_CONTRACT_STATE_KEY', 'MISSING_TICK', 'MISSING_WIF', 'NATIVE_FEE_INVALID',
        'NATIVE_FEE_UNSUPPORTED', 'NETWORK_NOT_CONFIGURED', 'WEBSOCKET_NOT_CONFIGURED',
    ], 'The wallet is not configured for this request. Check the selected network in Settings and try again.'],
    ['SDKContractError', [
        'CODE_ENCODING_FAILED', 'CONTRACT_LINT_FAILED', 'INVALID_CONTRACT_INDEX', 'TEMPLATE_NOT_FOUND',
    ], 'The contract request could not be prepared. Check the contract details and try again.'],
    ['SDKEncoderError', [
        'ENCODER_NETWORK', 'ENCODER_RPC_ERROR', 'ENCODER_TIMEOUT', 'MISSING_ADDRESS', 'MISSING_DATA',
        'MISSING_P2SH_HASH', 'MISSING_P2SH_HEX', 'MISSING_PUBKEY', 'MISSING_TX_HEX', 'NO_UTXOS',
        'UTXO_TRACKER_STALE',
    ], 'The transaction service could not complete this request. Check the transaction details and try again.'],
    ['SDKExplorerError', [
        'COIN_DATA_STALE', 'EXPLORER_BAD_FEEQUOTE', 'EXPLORER_BATCH_UNSUPPORTED', 'EXPLORER_NETWORK',
        'EXPLORER_TIMEOUT', 'EXPLORER_UNKNOWN', 'INVALID_ADDRESSES', 'INVALID_NETWORK', 'WS_CONNECTION_CLOSED',
        'WS_CONNECTION_FAILED', 'WS_TIMEOUT',
    ], 'The service that reads the chain could not answer. Check your connection and try again.'],
    ['SDKFormatError', [
        'EMPTY', 'INCONSISTENT_SHARED_FIELD', 'INVALID_LEGS', 'INVALID_VERSION', 'LEG_FIELD_NOT_IN_FORMAT',
        'NO_MATCHING_FORMAT', 'REPEATED_FORMAT_REQUIRES_LEGS', 'SINGLE_LEG_FORMAT', 'UNENCODABLE_INPUT',
        'UNKNOWN_ACTION', 'UNSUPPORTED_REPEATED_FORMAT',
    ], 'The wallet could not prepare this action from the form values. Review the form and try again.'],
    ['SDKGatedFileError', [
        'DECRYPT_FAILED', 'INVALID_CIPHERTEXT', 'INVALID_KEY', 'INVALID_PACK', 'INVALID_PAYLOAD',
        'INVALID_PLAINTEXT',
    ], 'The protected file could not be prepared. Check the file and key, then try again.'],
    ['SDKHubError', ['HUB_UNAVAILABLE'],
        'The wallet could not reach its service directory. Check your connection and try again.'],
    ['SDKMessagingError', [
        'DECRYPTION_FAILED', 'ENCODER_REQUIRED', 'EXPLORER_REQUIRED', 'INVALID_ADDRESS',
        'INVALID_CIPHERTEXT', 'INVALID_COIN', 'INVALID_DESTINATION', 'INVALID_KEY', 'INVALID_MESSAGE',
        'INVALID_METHOD', 'INVALID_PUBKEY', 'INVALID_TYPE', 'INVALID_WIF', 'NETWORK_NOT_CONFIGURED',
        'PUBKEY_NOT_FOUND', 'SDK_REQUIRED', 'SHARED_KEY_REQUIRED', 'SHARED_SECRET_REQUIRED',
    ], 'The wallet could not prepare this message. Check the recipient and message, then try again.'],
    ['SDKMuSigError', [
        'DETERMINISTIC_SIGN_FAILED', 'INVALID_INPUT', 'KEY_AGG_FAILED', 'NONCE_AGG_FAILED',
        'NONCE_GEN_FAILED', 'PARTIAL_SIGN_FAILED', 'PARTIAL_VERIFY_FAILED', 'SESSION_ID_REUSED',
        'SESSION_START_FAILED', 'SIG_AGG_FAILED',
    ], 'The wallet could not complete the shared signature. Reconnect every signer and try again.'],
    ['SDKPolicyError', [
        'CANNOT_CHECK_FEE', 'CANNOT_CHECK_OUTPUTS', 'CANNOT_DERIVE_SIGHASH', 'CONFIRMATION_REQUIRED',
        'COSIGNER_BAD_RESPONSE', 'COSIGNER_CONFIG', 'COSIGNER_DENIED', 'COSIGNER_KEY_MISMATCH',
        'COSIGNER_MSG_MISMATCH', 'COSIGNER_MSG_UNVERIFIABLE', 'COSIGNER_TRANSPORT_ERROR',
        'DECODE_BAD_VERSION', 'DECODE_BATCH_UNSUPPORTED', 'DECODE_DEOBFUSCATION_FAILED',
        'DECODE_ENVELOPE_MIXED_CARRIER', 'DECODE_ENVELOPE_NOT_INPUT_ZERO',
        'DECODE_ENVELOPE_SCRIPT_INVALID', 'DECODE_FIELD_COUNT_MISMATCH', 'DECODE_INNER_DECOMPILE_FAILED',
        'DECODE_MALFORMED_ACTION_STRING', 'DECODE_MULTI_ENVELOPE', 'DECODE_MULTI_LEG_UNSUPPORTED',
        'DECODE_MULTI_OP_RETURN', 'DECODE_NOT_UTF8', 'DECODE_NO_ENVELOPE', 'DECODE_NO_INPUTS',
        'DECODE_NO_MAGIC_WORD', 'DECODE_NO_OP_RETURN', 'DECODE_OVERSIZED',
        'DECODE_P2SH_P2WSH_UNSUPPORTED', 'DECODE_PARAM_INVALID', 'DECODE_PSBT_PARSE_FAILED',
        'DECODE_REST_FIELD_TOO_LONG', 'DECODE_REST_FIELD_UNSUPPORTED', 'DECODE_UNEXPECTED_FORMAT',
        'DECODE_UNKNOWN_ACTION',
        'DUPLICATE_INPUT_INDEX', 'ENVELOPE_COMMIT_UNBOUNDED', 'ENVELOPE_MIXED_CARRIER',
        'ENVELOPE_NOT_COMMITTED', 'ENVELOPE_SCRIPT_INVALID', 'FEE_BURNS_ENTIRE_INPUT',
        'FEE_EXCEEDS_CAP', 'INPUT_INDEX_OUT_OF_RANGE', 'MIXED_INPUT_SCRIPTS', 'MUSIG2_NO_INPUTS',
        'NO_INPUTS_REQUESTED', 'NO_PSBT', 'OP_RETURN_CARRIES_VALUE', 'OUTPUT_OVER_CAP',
        'OUTPUTS_EXCEED_INPUTS', 'POLICY_ACTION_DENIED', 'POLICY_AMOUNT_EXCEEDED',
        'POLICY_AMOUNT_INVALID', 'POLICY_CONFIRMATION_DENIED', 'POLICY_DESTINATION_DENIED',
        'POLICY_DESTINATION_UNENFORCEABLE', 'POLICY_DUPLICATE_SUBMIT', 'POLICY_HALTED',
        'POLICY_IDEMPOTENCY_REQUIRED', 'POLICY_INVALID', 'POLICY_STATE_CORRUPT',
        'POLICY_TICK_CASE_COLLISION', 'POLICY_UNBOUNDED_ACTION', 'POLICY_UNRESOLVED_TICK',
        'POLICY_WINDOW_AMOUNT_EXCEEDED', 'POLICY_WINDOW_COUNT_EXCEEDED', 'PREVOUT_NOT_OUR_ACCOUNT',
        'PSBT_PARSE_FAILED', 'SIGHASH_TYPE_NOT_ALLOWED', 'SIGN_FAILED', 'SOURCE_NOT_OUR_ACCOUNT',
        'TOO_MANY_INPUTS', 'UNAUTHORIZED_OUTPUT',
    ], 'This request does not meet the signing policy. Review the policy and try again.'],
    ['SDKPreflightError', ['PREFLIGHT_FAIL'],
        'This action would be rejected before it confirms. Review the form and try again.'],
    ['SDKRateLimitedError', ['RATE_LIMITED'],
        'The service is receiving too many requests. Wait a moment and try again.'],
    ['SDKValidationError', [
        'BATCH_CONSTRAINT', 'BATCH_EMPTY', 'ENCODING_DATA_TOO_LARGE', 'INVALID_FIELD_VALUE',
        'MISSING_ACTION', 'MISSING_COMPRESSED_PUBKEY', 'MISSING_REQUIRED_FIELD', 'UNKNOWN_ACTION',
    ], 'The wallet could not validate this action. Review the form and try again.'],
    ['SDKWalletError', [
        'BROADCAST_FAILED', 'ENCODER_REQUIRED', 'FINALIZE_FAILED', 'INVALID_ADDRESS',
        'INVALID_ADDRESS_TYPE', 'INVALID_INPUT', 'INVALID_PSBT', 'INVALID_PUBLIC_KEY', 'INVALID_SCHEME',
        'INVALID_SCRIPT_TEMPLATE', 'INVALID_TX_HEX', 'INVALID_UTXOS', 'INVALID_WIF',
        'MULTISIG_DERIVE_FAILED', 'NETWORK_MISMATCH', 'NETWORK_NOT_CONFIGURED', 'NO_CONFIRMED_UTXOS',
        'P2TR_FAILED', 'SEGWIT_NOT_SUPPORTED', 'SIGN_FAILED', 'UTXO_FETCH_FAILED', 'UTXO_NOT_FOUND',
    ], 'The wallet could not prepare or sign this request. Check the wallet details and try again.'],
    ['SDKX402Error', [
        'X402_CONFIG', 'X402_INVOICE_ALREADY_USED', 'X402_NO_USABLE_SCHEME', 'X402_PAYMENT_AMBIGUOUS',
        'X402_PRICE_TOO_HIGH', 'X402_STATE_CORRUPT',
    ], 'The service payment could not be verified. Check the payment details and try again.'],
];

const LOCAL_CODE_MESSAGES = Object.freeze({
    HUB_UNAVAILABLE: 'The wallet could not reach its service directory. Check your connection and try again.',
    NON_FINITE_AMOUNT: 'A wallet service returned an invalid amount. Try again, and report it if it continues.',
    INVALID_SATS_AMOUNT: 'A wallet service returned an invalid amount. Try again, and report it if it continues.',
    REVEAL_INPUTS_REFUSED: 'The follow-up transaction did not match the first transaction, so nothing was signed or sent. Try again, and report it if it continues.',
});

const NAME_ONLY_MESSAGES = Object.freeze({
    OracleFeeUnpayableError: 'The wallet could not confirm the required oracle fee. Check the oracle settings and try again.',
    UnknownChainError: 'The wallet does not recognize the selected network. Choose a supported network in Settings and try again.',
});

export const KNOWN_SDK_ERROR_CODES = Object.freeze(GROUPS.flatMap(([name, codes, message]) => (
    codes.map((code) => Object.freeze({ name, code, message }))
)));

const MESSAGE_BY_IDENTITY = new Map(
    KNOWN_SDK_ERROR_CODES.map(({ name, code, message }) => [`${name}:${code}`, message]),
);
const ENCODER_CODES = new Set(
    KNOWN_SDK_ERROR_CODES.filter(({ name }) => name === 'SDKEncoderError').map(({ code }) => code),
);
const ENCODER_MESSAGE = 'The transaction service could not complete this request. '
    + 'Check the transaction details and try again.';

function errorCode(err) {
    if (!err || typeof err !== 'object') return '';
    const code = /** @type {any} */ (err).code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : '';
}

/** Plain copy for an SDK code shipped with this wallet. */
export function knownSdkErrorMessage(err) {
    if (!err || typeof err !== 'object') return null;
    const e = /** @type {any} */ (err);
    const code = errorCode(e);
    if (LOCAL_CODE_MESSAGES[code]) return LOCAL_CODE_MESSAGES[code];
    if (!code) return NAME_ONLY_MESSAGES[String(e.name || '')] || null;
    if (ENCODER_CODES.has(code) || /^ENCODER_HTTP_\d{3}$/.test(code)) return ENCODER_MESSAGE;
    if (/^EXPLORER_HTTP_\d{3}$/.test(code)) {
        return 'The service that reads the chain could not answer. Check your connection and try again.';
    }
    return MESSAGE_BY_IDENTITY.get(`${String(e.name || '')}:${code}`) || null;
}

/** A future SDK code that belongs only in a collapsed technical disclosure. */
export function unknownSdkErrorCode(err) {
    if (!err || typeof err !== 'object') return '';
    const e = /** @type {any} */ (err);
    const code = errorCode(e);
    if (!code || knownSdkErrorMessage(e)) return '';
    return /^SDK[A-Za-z]*Error$/.test(String(e.name || ''))
        || /^(?:ENCODER|EXPLORER)_/.test(code) ? code : '';
}
