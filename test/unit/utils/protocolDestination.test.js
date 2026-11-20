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
    protocolDestinationFindings,
    protocolDestinationKind,
} from '../../../packages/core/src/shared/utils/protocolDestination.js';

const CHAIN_ID = 'dogecoin-testnet';

describe('protocolDestinationKind', () => {
    it('recognizes bridge escrow addresses without case folding them', () => {
        expect(protocolDestinationKind('nUdogebridgebtcXXXXXXXXXXXXXWUG2kx', CHAIN_ID)).toBe('bridge');
        expect(protocolDestinationKind('nUdogebridgeLtcXXXXXXXXXXXXXTsEz6W', CHAIN_ID)).toBe('bridge');
        expect(protocolDestinationKind('nudogebridgebtcxxxxxxxxxxxxxwug2kx', CHAIN_ID)).toBeNull();
    });

    it('distinguishes the intentional burn destination from bridge escrow', () => {
        expect(protocolDestinationKind('nchainburnaddressXXXXXXXXXXXYKgF7W', CHAIN_ID)).toBe('burn');
        expect(protocolDestinationKind('nordinaryaddress1111111111111111111', CHAIN_ID)).toBeNull();
    });

    it('finds keyless destinations in added recipient rows', () => {
        expect(protocolDestinationFindings([
            'nordinaryaddress1111111111111111111',
            'nUdogebridgebtcXXXXXXXXXXXXXWUG2kx',
            'nchainburnaddressXXXXXXXXXXXYKgF7W',
        ], CHAIN_ID)).toEqual([
            { index: 1, kind: 'bridge' },
            { index: 2, kind: 'burn' },
        ]);
    });

    it('ships the Dogecoin testnet protocol destinations in the wallet safety table', () => {
        expect(protocolDestinationKind('nUdogebridgebtcXXXXXXXXXXXXXWUG2kx', CHAIN_ID)).toBe('bridge');
        expect(protocolDestinationKind('nchainburnaddressXXXXXXXXXXXYKgF7W', CHAIN_ID)).toBe('burn');
    });
});
