// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A message that will not send says so in the wallet's voice.
//
// ComposeMessage had two submit catches, the confirm-flow one and the legacy
// review-then-submit one, and both assigned `err?.message || 'Send failed.'`
// into the banner. The SDK encoder writes for a log, so an unfunded sending
// address surfaced "no spendable UTXOs found for the funding address" on the
// screen a user reads. submitFailureMessage owns that translation and every
// other form's submit paths already go through it.
//
// Pinned in two halves, because the defect had two halves:
//
//   (a) STRUCTURAL - both catches route through the helper. The helper's own
//       header names this trap: a form swept on ONE submit path is still
//       broken on the other, and a render test that drives only the confirm
//       flow would report the legacy path as fixed.
//   (b) BEHAVIOURAL - the arguments those catches pass really do turn the
//       encoder's log line into the funding sentence, and really do fall back
//       to this form's own copy for a failure nothing recognises.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
    join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'ComposeMessage.jsx'),
    'utf8',
);

/** An SDK encoder refusal as it arrives after the messaging boundary. */
function encoderError(message, code) {
    const err = new Error(message);
    err.name = 'SDKEncoderError';
    err.code = code;
    return err;
}

describe('ComposeMessage turns a failed send into a sentence', () => {
    it('routes BOTH submit catches through the shared helper', () => {
        const calls = SRC.match(/submitFailureMessage\(err, \{[\s\S]{0,160}?\}\)/g) || [];
        expect(calls.length, 'the confirm-flow catch and the legacy submit catch each map their failure')
            .toBe(2);
        for (const call of calls) {
            // The fallback keeps err.message AHEAD of this form's own copy,
            // which is submitFailureMessage's stated contract ("the message the
            // form would have shown") and what every other swept form passes.
            // Pinning the bare house string instead let a specific host reason,
            // such as an insufficient-funds shortfall naming the amount
            // required, be swallowed behind "Send failed." while this guard
            // stayed green; composeMessageSendPath.test.jsx is the behavioural
            // test that caught it.
            expect(call).toContain("fallback: err?.message || 'Send failed.'");
            expect(call).toContain('coinTicker: nativeTicker');
            expect(call).toContain('chainId');
        }
    });

    it('imports the helper it calls, so the catch cannot throw a ReferenceError', () => {
        const imports = SRC.match(/import\s*\{[^}]*\}\s*from\s*'[^']*';/g) || [];
        expect(imports.some((s) => /\bsubmitFailureMessage\b/.test(s))).toBe(true);
    });

    it('leaves no bare err.message on either submit path', () => {
        expect(SRC).not.toContain("setSubmitError(err?.message || 'Send failed.')");
    });

    it('turns the encoder log line into the funding sentence, not the raw text', () => {
        const raw = 'no spendable UTXOs found for the funding address';
        const shown = submitFailureMessage(encoderError(raw, 'ENCODER_NO_UTXOS'), {
            chainId: 'bitcoin-mainnet', coinTicker: 'BTC', fallback: 'Send failed.',
        });
        expect(shown).not.toContain(raw);
        expect(shown).not.toBe('Send failed.');
        expect(shown.length).toBeGreaterThan(raw.length);
    });

    it("keeps this form's own copy for a failure the helper does not recognise", () => {
        const shown = submitFailureMessage(new Error('something nobody mapped'), {
            chainId: 'bitcoin-mainnet', coinTicker: 'BTC', fallback: 'Send failed.',
        });
        expect(shown).toBe('Send failed.');
    });
});
