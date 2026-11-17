// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wallet and protocol terms a non-technical person does not know. Both the
// English-locale scan and the first-launch license scan use this one list.
export const PLAIN_LANGUAGE_TERMS = [
    'Token Spec', 'UTXO', 'UTXOs', 'sat/vB', 'vbyte', 'vbytes', 'nonce', 'scriptPubKey', 'xpub', 'descriptor',
    'derivation path', 'BIP39', 'BIP32', 'OP_RETURN', 'payload', 'envelope', 'witness', 'mempool', 'RBF',
    'CPFP', 'pubkey', 'sighash', 'txid', 'ABI', 'calldata', 'hex',
];

export const PLAIN_LANGUAGE_TERM_PATTERN = new RegExp(
    `(?<![A-Za-z0-9_])(?:${PLAIN_LANGUAGE_TERMS.map((term) => term.replace(/[/_]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![A-Za-z0-9_])`,
    'i',
);
