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

import {
    assertMultipartActive,
    isMultipartActive,
} from '../../../packages/core/src/flows/multipartActivationGate.js';

const ACTIVATION_TIMES = {
    mainnet: 'UNARMED',
    testnet: 1796083200,
    regtest: 0,
};

const active = (chainId, tip, activationTimes = ACTIVATION_TIMES) => (
    isMultipartActive({ chainId, tip, activationTimes })
);

describe('multipart activation decision', () => {
    it('fails closed when mainnet is unarmed', () => {
        expect(active('bitcoin-mainnet', { protocolTime: 9999999999 })).toBe(false);
    });

    it('activates testnet at its protocol time inclusively', () => {
        expect(active('litecoin-testnet', { protocolTime: 1796083199 })).toBe(false);
        expect(active('litecoin-testnet', { protocolTime: 1796083200 })).toBe(true);
    });

    it('keeps a time-zero regtest active without a tip', () => {
        expect(active('dogecoin-regtest', null)).toBe(true);
    });

    it('does not fall back to block time when protocol time is unavailable', () => {
        expect(active('bitcoin-testnet', { blockTime: 1796083200, protocolTime: null })).toBe(false);
        expect(active('bitcoin-testnet', null)).toBe(false);
    });

    it('fails closed for a missing activation key', () => {
        expect(active('bitcoin-testnet', { protocolTime: 9999999999 }, { regtest: 0 })).toBe(false);
    });

    it('fails closed for an unknown network segment', () => {
        expect(active('bitcoin-signet', { protocolTime: 9999999999 })).toBe(false);
    });
});

describe('multipart activation assertion', () => {
    const assertAt = (chainId, tip, activationTimes = ACTIVATION_TIMES) => (
        assertMultipartActive({ chainId, tip, activationTimes })
    );

    it('passes once multipart files are active', () => {
        expect(() => assertAt('bitcoin-testnet', { protocolTime: 1796083200 })).not.toThrow();
    });

    it('throws the typed refusal whenever multipart files are inactive', () => {
        for (const [chainId, tip] of [
            ['bitcoin-mainnet', { protocolTime: 9999999999 }],
            ['bitcoin-testnet', { blockTime: 9999999999 }],
            ['bitcoin-signet', { protocolTime: 9999999999 }],
        ]) {
            expect(() => assertAt(chainId, tip)).toThrow(expect.objectContaining({
                code: 'MULTIPART_NOT_ACTIVE',
            }));
        }
    });
});
