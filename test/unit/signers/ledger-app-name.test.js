// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// ledgerIdentity.js keeps its own copy of the chain-to-app table so the
// connect flow and the sign page can name a Ledger app without loading the
// signer package. This holds the copy equal to LedgerSigner's table on every
// network the Ledger support table knows, in both directions.

import { describe, expect, it } from 'vitest';
import { ledgerAppNameFor } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { LEDGER_APP_NAME_FOR_CHAIN } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { LEDGER_NETWORK_SUPPORT } from '../../../packages/signers-ledger/src/ledgerFormat.js';

describe('ledgerAppNameFor', () => {
    const chainIds = [...new Set([...Object.keys(LEDGER_NETWORK_SUPPORT), ...Object.keys(LEDGER_APP_NAME_FOR_CHAIN)])];

    it.each(chainIds)('%s matches LedgerSigner', (chainId) => {
        const theirs = Object.prototype.hasOwnProperty.call(LEDGER_APP_NAME_FOR_CHAIN, chainId)
            ? LEDGER_APP_NAME_FOR_CHAIN[chainId]
            : null;
        expect(ledgerAppNameFor(chainId)).toBe(theirs);
    });

    it('names an app for exactly the networks a Ledger signs', () => {
        for (const chainId of Object.keys(LEDGER_NETWORK_SUPPORT)) {
            expect([chainId, ledgerAppNameFor(chainId) !== null]).toEqual([chainId, LEDGER_NETWORK_SUPPORT[chainId].supported]);
        }
    });

    it('has no app for an unknown or empty chain', () => {
        expect(ledgerAppNameFor('ethereum-mainnet')).toBeNull();
        expect(ledgerAppNameFor(undefined)).toBeNull();
        expect(ledgerAppNameFor('toString')).toBeNull();
    });
});
