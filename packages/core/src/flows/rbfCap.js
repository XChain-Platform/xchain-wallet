// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// rbfCap. The one place the chain's RBF capability is enforced on the bytes.
//
// The encoder signals replace-by-fee whenever it is handed `rbf: true` and
// knows nothing about the chain, so every core path that calls
// encoder.createTx runs its options through here first.

/**
 * Return encoder options whose `rbf` the chain's descriptor allows.
 *
 * Only a descriptor declaring `feeStrategy.rbfSupported: true` keeps
 * `rbf: true`; any other chain, and a missing descriptor, gets an explicit
 * `rbf: false`. Options that do not ask for RBF come back unchanged.
 *
 * @template {{ rbf?: boolean } | null | undefined} T
 * @param {{ feeStrategy?: { rbfSupported?: boolean } } | null | undefined} descriptor
 * @param {T} encoderOpts
 * @returns {T}
 */
export function capRbfToDescriptor(descriptor, encoderOpts) {
    // Leave options alone unless they ask for RBF.
    if (encoderOpts?.rbf !== true) return encoderOpts;
    // Keep the request on a chain that declares RBF support.
    if (descriptor?.feeStrategy?.rbfSupported === true) return encoderOpts;
    // Refuse to signal RBF anywhere else, an unknown chain included.
    return { ...encoderOpts, rbf: false };
}
