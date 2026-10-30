// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    UNKNOWN_TOKEN_ISSUER_MESSAGE,
    tokenIssuerEligibility,
} from '../../../packages/core/src/shared/utils/tokenIssuerEligibility.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qowner';

describe('tokenIssuerEligibility', () => {
    it('distinguishes a pending lookup from a resolved token with no issuer', () => {
        expect(tokenIssuerEligibility({
            tokenInfo: null,
            addressesByChain: null,
            chainId: CHAIN,
            tick: 'TOKEN',
        })).toMatchObject({ pending: true, error: null });

        expect(tokenIssuerEligibility({
            tokenInfo: { creator: null },
            addressesByChain: { [CHAIN]: [{ address: OWNER }] },
            chainId: CHAIN,
            tick: 'TOKEN',
        })).toMatchObject({ pending: false, error: UNKNOWN_TOKEN_ISSUER_MESSAGE });
    });

    it('accepts only the confirmed issuer as the signing source', () => {
        expect(tokenIssuerEligibility({
            tokenInfo: { creator: OWNER },
            addressesByChain: { [CHAIN]: [{ address: OWNER }] },
            chainId: CHAIN,
            tick: 'TOKEN',
            sourceAddress: OWNER,
        })).toMatchObject({ pending: false, error: null, issuerAddress: OWNER });

        expect(tokenIssuerEligibility({
            tokenInfo: { creator: OWNER },
            addressesByChain: { [CHAIN]: [{ address: 'bc1qother' }] },
            chainId: CHAIN,
            tick: 'TOKEN',
            sourceAddress: 'bc1qother',
        }).error).toContain('This wallet does not own TOKEN');
    });
});
