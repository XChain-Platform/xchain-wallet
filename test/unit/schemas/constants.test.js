// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/constants - shared enum arrays.

import { describe, it, expect } from 'vitest';
import {
    NETWORKS,
    ACTION_PERMISSIONS,
    ADDRESS_SOURCES,
} from '../../../packages/core/src/schemas/constants.js';

describe('schemas/constants', () => {
    describe('NETWORKS', () => {
        it('contains mainnet, testnet, regtest', () => {
            expect(NETWORKS).toContain('mainnet');
            expect(NETWORKS).toContain('testnet');
            expect(NETWORKS).toContain('regtest');
        });

        it('has exactly 3 entries', () => {
            expect(NETWORKS).toHaveLength(3);
        });
    });

    describe('ACTION_PERMISSIONS', () => {
        it('contains always, ask, never', () => {
            expect(ACTION_PERMISSIONS).toContain('always');
            expect(ACTION_PERMISSIONS).toContain('ask');
            expect(ACTION_PERMISSIONS).toContain('never');
        });

        it('has exactly 3 entries', () => {
            expect(ACTION_PERMISSIONS).toHaveLength(3);
        });
    });

    describe('ADDRESS_SOURCES', () => {
        it('contains hd, imported-wif, watch-only, trezor, ledger', () => {
            expect(ADDRESS_SOURCES).toContain('hd');
            expect(ADDRESS_SOURCES).toContain('imported-wif');
            expect(ADDRESS_SOURCES).toContain('watch-only');
            expect(ADDRESS_SOURCES).toContain('trezor');
            expect(ADDRESS_SOURCES).toContain('ledger');
        });

        it('has exactly 5 entries', () => {
            expect(ADDRESS_SOURCES).toHaveLength(5);
        });
    });
});
