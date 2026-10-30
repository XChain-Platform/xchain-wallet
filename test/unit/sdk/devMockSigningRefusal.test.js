// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The dev-mock SDK cannot sign. A sweep, send or message signature on it must
// say so in plain words, through the same mapping every form uses, rather
// than the generic "Something went wrong" line.

import { describe, expect, it } from 'vitest';
import { createDevMockSdk } from '../../../packages/extension/src/background/sdkFactory.js';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';
import {
    hydrateEnvelopeError,
    serializeError,
} from '../../../packages/extension/src/background/MessageHost.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';
import { DEV_MOCK_SIGNING_UNAVAILABLE } from '../../../packages/core/src/sdk/devMockErrors.js';

const SENTENCE = 'This development build cannot sign. Nothing was signed or sent. Run a build with the wallet SDK to try it.';

function caught(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    throw new Error('expected a throw');
}

const SHELLS = [
    ['extension', () => createDevMockSdk({ network: 'bitcoin-testnet' })],
    ['web', () => __createDevMockSdkForTests({ network: 'bitcoin-testnet' })],
];

describe('dev-mock signing refusal', () => {
    it.each(SHELLS)('%s stubs refuse with the coded error and keep the release-gate marker', (_shell, make) => {
        const sdk = make();
        for (const err of [
            caught(() => sdk.wallet.signPsbt('70736274ff')),
            caught(() => sdk.auth.signMessage('hello')),
        ]) {
            expect(err.code).toBe(DEV_MOCK_SIGNING_UNAVAILABLE);
            expect(err.message).toMatch(/^Dev SDK stub: /);
        }
    });

    it.each(SHELLS)('a %s sweep refused by the stub reads in plain words after the message hop', (_shell, make) => {
        const sdk = make();
        const thrown = caught(() => sdk.wallet.signPsbt('70736274ff'));
        const err = hydrateEnvelopeError(serializeError(thrown).error);
        // The same call SweepForm makes when Approve fails.
        const copy = submitFailureMessage(err, {
            chainId: 'bitcoin-testnet',
            coinTicker: 'BTC',
            fallback: humanizeError(err, 'sweep').message,
        });
        expect(copy).toBe(SENTENCE);
    });

    it('a message signature refused by the stub reads in plain words', () => {
        const thrown = caught(() => createDevMockSdk({ network: 'bitcoin-testnet' }).auth.signMessage('hello'));
        const err = hydrateEnvelopeError(serializeError(thrown).error);
        expect(submitFailureMessage(err, { fallback: err.message })).toBe(SENTENCE);
    });
});
