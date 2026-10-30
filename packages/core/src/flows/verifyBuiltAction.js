// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm pipeline's tamper checks (§5.3.2), for a PSBT the ATOMIC submit
// path built itself.
//
// The in-app confirm flow composes one PSBT, runs assertNoTamper on it and
// signs those exact bytes. A dApp `signAction` (bridge SEND / SWEEP) takes the
// other road: the user approves the intent, then submitWithSigner asks the
// encoder service for a PSBT and signed whatever came back. The encoder is a
// network service, so that was an unchecked signature over bytes nobody had
// compared to the approved action. This runs the same three checks on those
// bytes, between createTx and the signer, against what the wallet itself
// asked the encoder for:
//
//   - every output is one the wallet requested (the recipient, a protocol or
//     oracle fee, the ADS donation), change to the spender, or the carrier;
//     every requested output is present at its exact value;
//   - an inline OP_RETURN carries exactly the action string the wallet made;
//   - chunk-lane carrier scripts hash to the PSBT's outputs and spell the
//     action; a Taproot envelope's reveal spends only the commit and pays only
//     the wallet.
//
// The expected-output set is assembled the way composeForConfirm assembles it,
// so a request that passes the confirm screen's check passes this one.
// Read-only: it never changes the bytes, so a request that passes signs
// exactly what it signed before.

import { assertNoTamper, buildExpectedOutputs, TamperDetectedError } from './confirmChecks.js';
import { isChunkEncoding } from './nativeFeeLane.js';
import { compiledPayloadByteLen } from './envelopeSelection.js';
import { checkEnvelopeReveal, envelopeRevealRefusalMessage } from './envelopeRevealCheck.js';

const MISMATCH = 'The action encoded in the transaction does not match what you approved.';

/**
 * Throw TamperDetectedError unless `encoded` is the transaction the wallet asked for.
 *
 * @param {Object} args
 * @param {any} args.sdk                            the chain's SDK (wallet.decomposePsbt, decoder.*)
 * @param {{ psbt: string, encoding: string, carrierScripts?: string[], compression?: any, revealPsbt?: string, envelope?: any }} args.encoded
 *   the encoder's create_tx answer
 * @param {string | null} args.actionString         the action string the wallet created; null for a bare payment
 * @param {boolean} args.bareNativePayment
 * @param {Array<{ address: string, value: number | string }>} [args.customOutputs]
 *   every output the wallet asked the encoder to add, read AFTER createTx (the ADS fold appends to the same array)
 * @param {Iterable<string>} args.ownAddresses      the spender and the change address
 * @param {unknown} [args.rawData]                   the payload handed to the encoder, if any
 */
export function assertBuiltActionMatchesIntent({
    sdk, encoded, actionString, bareNativePayment, customOutputs = [], ownAddresses, rawData,
}) {
    if (!encoded || typeof encoded.psbt !== 'string' || encoded.psbt.length === 0) {
        throw new TamperDetectedError(MISMATCH, { reason: 'no-psbt' });
    }
    // The confirm lane accepts a payload the encoder compressed only after
    // checking the rewritten string against its own; this lane never asks for
    // compression, so a report of one is an answer to a different request.
    if (encoded.compression?.compressed === true) {
        throw new TamperDetectedError(MISMATCH, { reason: 'unrequested-compression' });
    }
    const own = [...new Set([...(ownAddresses || [])].filter(Boolean).map(String))];
    const requested = Array.isArray(customOutputs) ? customOutputs : [];

    // On the chunk lane the commit carries no custom output: the encoder folds
    // each one's value into the script output and the reveal emits it. So the
    // phase-1 expected set drops them all, exactly as composeForConfirm drops
    // its deferred outputs.
    const chunk = !bareNativePayment && isChunkEncoding(encoded.encoding);
    const envelopePair = Boolean(encoded.revealPsbt || encoded.envelope);
    if (envelopePair && !(encoded.revealPsbt && encoded.envelope)) {
        throw new TamperDetectedError(MISMATCH, { reason: 'envelope-incomplete' });
    }
    const envelope = envelopePair ? encoded.envelope : null;
    const expectedCustom = [
        ...(chunk ? [] : requested),
        ...(envelope ? [{ address: envelope.commitAddress, value: envelope.commitValue }] : []),
    ];
    const expected = buildExpectedOutputs({
        customOutputs: expectedCustom,
        encoding: bareNativePayment ? null : encoded.encoding,
        payloadByteLen: bareNativePayment || !actionString
            ? undefined
            : compiledPayloadByteLen(actionString, rawData ?? null, null),
    });

    assertNoTamper({
        psbtHex: encoded.psbt,
        expected,
        ownAddresses: own,
        decomposePsbt: (hex) => sdk.wallet.decomposePsbt(hex),
        actionString,
        // The raw string extractor, as the confirm lane uses for the wallet's
        // own actions; decodeActionFromPsbt is the co-signer policy decoder.
        decodeActionFromPsbt: (hex) => sdk.decoder.decodeActionStringFromPsbt(hex),
        psbt: encoded.psbt,
        carrierScripts: Array.isArray(encoded.carrierScripts) ? encoded.carrierScripts : [],
        rawData: rawData ?? null,
        rawDataCompressed: false,
        network: sdk.config && sdk.config.network,
        verifyCarrierScripts: sdk.decoder?.verifyCarrierScripts,
    });

    if (envelope) {
        const verdict = checkEnvelopeReveal({
            commit: sdk.wallet.decomposePsbt(encoded.psbt),
            reveal: sdk.wallet.decomposePsbt(encoded.revealPsbt),
            envelope,
            ownAddresses: own,
            actionString,
            decodeRevealAction: () => sdk.decoder.decodeActionFromPsbt(encoded.revealPsbt),
            revealPsbt: encoded.revealPsbt,
            network: sdk.config && sdk.config.network,
            assertEnvelopeCarrierBinding: sdk.decoder?.assertEnvelopeCarrierBinding,
        });
        if (!verdict.ok) {
            throw new TamperDetectedError(envelopeRevealRefusalMessage(verdict.reason),
                { reason: verdict.reason, decodeReason: verdict.decodeReason });
        }
    }
}
