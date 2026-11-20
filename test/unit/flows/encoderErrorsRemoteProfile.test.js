// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The encoder's remote tracker profile words its stale refusal differently from
// the default profile; after the real messaging round trip both must read as stale.

import { describe, it, expect } from 'vitest';
import { encoderErrorCode, encoderErrorMessage } from '../../../packages/core/src/sdk/encoderErrors.js';
import { serializeError, hydrateEnvelopeError } from '../../../packages/extension/src/background/MessageHost.js';

// The encoder's own refusals (xchain-encoder trackerless_profile.js), as the SDK wraps them.
const REMOTE_STALE = 'utxo-tracker did not assert that it is synced; refusing to select utxos from it';
const REMOTE_SYNC_MISSING = 'utxo-tracker did not report its sync state; the remote profile refuses an unattested view';

function encoderRpcError(reason, message) {
    const err = new Error(`Encoder RPC error: ${message}`);
    err.name = 'SDKEncoderError';
    err.code = 'ENCODER_RPC_ERROR';
    err.details = { method: 'create_tx', rpcError: { code: -32010, message, data: { reason } }, context: { reason } };
    return err;
}

// What a form in the popup catches: the real envelope, serialized and hydrated.
const roundTrip = (err) => hydrateEnvelopeError(serializeError(err).error);

describe('encoderErrorCode: remote tracker profile wording', () => {
    it('reads the remote-profile stale refusal as stale after the messaging round trip', () => {
        const wire = roundTrip(encoderRpcError('UTXO_TRACKER_STALE', REMOTE_STALE));
        expect(wire.details).toBeUndefined();
        expect(encoderErrorCode(wire)).toBe('UTXO_TRACKER_STALE');
        expect(encoderErrorMessage(wire, { coinTicker: 'LTC' })).toMatch(/not a problem with your wallet or your address/i);
    });

    it('keeps the unattested-view refusal out of the stale mapping', () => {
        const wire = roundTrip(encoderRpcError('UTXO_TRACKER_SYNC_MISSING', REMOTE_SYNC_MISSING));
        expect(encoderErrorCode(wire)).toBe('ENCODER_RPC_ERROR');
    });
});
