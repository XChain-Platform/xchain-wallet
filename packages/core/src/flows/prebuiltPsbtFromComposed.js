// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Turn a composed confirm result into the PrebuiltPsbt the submit path signs.
 *
 * The one place this mapping is written: every form, the shared confirm hook
 * and the resume screen call it, so a field compose adds reaches them all.
 *
 * @param {any} composed  the ComposedAction the confirm page previewed
 * @returns {import('../sdk/submitWithSigner.js').PrebuiltPsbt}
 */
export function prebuiltPsbtFromComposed(composed) {
    return {
        psbtHex: composed.psbt,
        encoding: composed.encoding,
        actionString: composed.actionString,
        version: composed.version,
        // On the two-phase lane the protocol fee rides the reveal, not the
        // previewed PSBT; carry it so the submit path attaches it there.
        deferredFeeOutput: composed.deferredFeeOutput || null,
        // ...and the rest of the deferred set, which the fee alone omitted.
        deferredOutputs: composed.deferredOutputs || [],
        // ...and the change the reveal must be built with, or its surplus
        // sweep lands on the un-rotated spending address.
        revealOpts: composed.revealOpts || null,
        // A TAPROOT envelope's reveal and recovery record. The submit path
        // refuses the commit unsigned if either did not arrive.
        revealPsbt: composed.revealPsbt || null,
        envelope: composed.envelope || null,
        // The donation verdict these bytes actually carry, so the submit path
        // books from compose time rather than a fresh settings snapshot.
        adsDonation: { included: !!composed.adsPlan?.canSubmit },
        // The encoder's compression report for these exact bytes, so the
        // success screen can state the size actually stored on chain.
        compression: composed.compression || null,
    };
}
