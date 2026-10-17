// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The installed SDK must expose the envelope carrier binding rule on its decoder.
//
// flows/envelopeRevealCheck.js refuses a Taproot reveal when the rule is
// missing, so an SDK without `decoder.assertEnvelopeCarrierBinding` turns every
// file over 8 KB into a tamper refusal before the confirm screen opens. The
// unit tests of that check inject a mock rule, so only the real package can
// show the wallet and its SDK pin agree.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('xchain-sdk decoder contract the confirm lane depends on', () => {
    it('exposes assertEnvelopeCarrierBinding', () => {
        // The package entry exports the same module every instance mounts as `sdk.decoder`.
        const { decoder } = require('xchain-sdk');
        expect(typeof decoder.assertEnvelopeCarrierBinding).toBe('function');
    });
});
