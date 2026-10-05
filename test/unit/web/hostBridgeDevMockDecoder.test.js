// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';

describe('hostBridge dev mock decoder', () => {
    it('decodes a mock PSBT through both action methods', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-regtest' });
        const actionString = 'SEND|0|XCP|1|destination';
        const { psbt } = await sdk.encoder.createTx({
            data: actionString,
            pubkey: '02aabb',
        });

        expect(sdk.decoder.decodeActionFromPsbt(psbt)).toEqual({ ok: true, actionString });
        expect(sdk.decoder.decodeActionStringFromPsbt(psbt)).toEqual({ ok: true, actionString });
    });

    it('reports decode-failed when the mock PSBT has no action', () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-regtest' });

        expect(sdk.decoder.decodeActionStringFromPsbt('invalid')).toEqual({
            ok: false,
            reason: 'decode-failed',
        });
    });
});
