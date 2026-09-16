// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dispenser purchase is a SEND to the dispenser's address, and History
// labelled it as exactly that: a plain send to a stranger. The caller may
// now name the pending record; every other send keeps the generic label.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/gatedSendGuard.js', () => ({
    prepareGatedSend: vi.fn(async () => null),
    getGatedGroupsForSend: vi.fn(async () => []),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'send-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';

const FROM = { address: 'bcrt1qsender', publicKey: '03dd4688', derivationPath: "m/84'/1'/0'/0/0" };
const DISPENSER = 'bcrt1qdispenser';

function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => ({}) },
        chainId: 'bitcoin-regtest',
        from: FROM,
        to: DISPENSER,
        tick: 'BTC',
        amount: '0.006',
        ...extra,
    };
}

const pendingMeta = () => vi.mocked(submitAction).mock.calls[0][0].pendingTxMeta;

describe('sendToken actionSummary', () => {
    beforeEach(() => vi.mocked(submitAction).mockClear());

    it('labels the pending record with the caller\'s summary', async () => {
        await sendToken(opts({ actionSummary: 'Buy 3 fills from dispenser #816: 0.006 BTC for 300 PEPE' }));
        expect(pendingMeta().actionSummary).toBe('Buy 3 fills from dispenser #816: 0.006 BTC for 300 PEPE');
        expect(pendingMeta().toAddress).toBe(DISPENSER);
    });

    it('[REGRESSION] keeps the generic label when no summary is given', async () => {
        await sendToken(opts());
        expect(pendingMeta().actionSummary).toBe(`Send 0.006 BTC to ${DISPENSER}`);
    });

    it('ignores a blank summary', async () => {
        await sendToken(opts({ actionSummary: '   ' }));
        expect(pendingMeta().actionSummary).toBe(`Send 0.006 BTC to ${DISPENSER}`);
    });

    it('[REGRESSION] still builds the native payment output beside the label', async () => {
        await sendToken(opts({ actionSummary: 'Buy 1 fill from dispenser #816' }));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.customOutputs).toEqual([{ address: DISPENSER, value: '600000' }]);
    });
});
