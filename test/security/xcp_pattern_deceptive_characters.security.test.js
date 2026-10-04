// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { signMessageFlow, signPsbtFlow } from '../../packages/core/src/flows/signFlows.js';
import { classifySignRisk } from '../../packages/core/src/flows/signRiskClassifier.js';

const common = {
    vault: {},
    walletId: 'wallet-1',
    chainRegistry: {},
    sdkRegistry: {},
    chainId: 'bitcoin-regtest',
};

describe('deceptive characters at signing boundaries', () => {
    it('refuses confusable characters before message signing', async () => {
        const signer = { signMessage: vi.fn() };
        await expect(signMessageFlow({
            ...common,
            path: "m/84'/0'/0'/0/0",
            message: 'Pay p\u0430ypal',
            signer,
        })).rejects.toThrow(/deceptive characters/i);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });

    it('refuses zero-width characters before PSBT signing', async () => {
        const signer = { signPsbt: vi.fn() };
        await expect(signPsbtFlow({
            ...common,
            psbtHex: 'dead\u200Bbeef',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            signer,
        })).rejects.toThrow(/deceptive characters/i);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('refuses bidi overrides before transaction risk classification', () => {
        expect(() => classifySignRisk({
            signerKind: 'trezor',
            amountSats: '1\u202E000',
            settings: { testSendThresholdSats: '1000' },
        })).toThrow(/deceptive characters/i);
    });
});
