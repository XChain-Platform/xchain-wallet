// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Shared JSDoc typedefs for the signer subsystem. No runtime exports
// — this module exists so cross-file `@typedef` references resolve in
// editors without each file redefining the shapes.
//
// Mirror of the normalized PSBT decomposition returned by
// `xchain-sdk`'s `WalletUtils.decomposePsbt(psbtHex)`. Keep this in
// sync with `xchain-sdk/src/wallet.js`'s JSDoc.

/**
 * @typedef {'p2wpkh'|'p2wsh'|'p2pkh'|'p2sh-p2wpkh'|'p2sh-p2wsh'|'p2sh'|'p2tr'|'unknown'} ScriptType
 */

/**
 * @typedef {Object} PrevTxInfo
 * @property {string} hash                                   display-order txid
 * @property {number} version
 * @property {number} locktime
 * @property {Array<{ prev_hash: string, prev_index: number, script_sig: string, sequence: number }>} inputs
 * @property {Array<{ amount: string, script_pubkey: string }>} bin_outputs
 */

/**
 * @typedef {Object} DecomposedPsbtInput
 * @property {string} prevTxHash                             display-order hex
 * @property {number} prevTxIndex
 * @property {number} sequence
 * @property {number} value                                  satoshis
 * @property {string} scriptPubKeyHex
 * @property {ScriptType} scriptType
 * @property {number|null} sighashType
 * @property {string|null} nonWitnessUtxoHex                 full prev-tx hex (legacy lane)
 * @property {string|null} witnessUtxoScriptHex              segwit lane
 * @property {string|null} redeemScriptHex
 * @property {string|null} witnessScriptHex
 * @property {string|null} address
 * @property {PrevTxInfo|null} prevTxInfo                    parsed form of nonWitnessUtxo
 */

/**
 * @typedef {Object} DecomposedPsbtOutput
 * @property {string|null} address
 * @property {string} scriptPubKeyHex
 * @property {ScriptType} scriptType
 * @property {number} value                                  satoshis
 */

/**
 * @typedef {Object} DecomposedPsbt
 * @property {number} txVersion
 * @property {number} locktime
 * @property {string|null} network
 * @property {DecomposedPsbtInput[]} inputs
 * @property {DecomposedPsbtOutput[]} outputs
 */

export {};
