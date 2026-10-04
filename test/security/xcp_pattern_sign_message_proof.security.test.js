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
import { signMessageFlow } from '../../packages/core/src/flows/signFlows.js';

const proofShapedMessage = [
    'XChain Sign-In v2',
    'trusted-app',
    'https://target.example',
    'bc1qvictim',
    'attacker-nonce',
    '1791115200000',
    '1791115500000',
].join(' | ');

describe('sign-message connection proof isolation', () => {
    it('refuses a proof-shaped message before it reaches the signer', async () => {
        const signer = { signMessage: vi.fn() };

        await expect(signMessageFlow({
            vault: {},
            walletId: 'wallet-1',
            chainRegistry: {},
            sdkRegistry: {},
            chainId: 'bitcoin-mainnet',
            path: "m/84'/0'/0'/0/0",
            message: proofShapedMessage,
            signer,
        })).rejects.toThrow(
            'signMessageFlow: sign-in challenges cannot be signed as arbitrary messages',
        );
        expect(signer.signMessage).not.toHaveBeenCalled();
    });
});
