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
    CHUNK_LANE_OPENER_RE,
    chunkLaneOpener,
    signerSubject,
} from '../../../../packages/core/src/shared/utils/chunkLaneCopy.js';

describe('chunkLaneOpener', () => {
    it('names known actions with their plain-language display label', () => {
        expect(chunkLaneOpener('DISPENSER')).toBe(
            'This Dispenser action is too large for one transaction: '
            + 'it has to go out as two linked transactions',
        );
        expect(chunkLaneOpener('execute')).toContain('This Contract call action');
    });

    it('humanizes an unknown action and tolerates surrounding whitespace', () => {
        expect(chunkLaneOpener('  FUTURE_ACTION  ')).toContain('This Future action action');
    });

    it('uses a generic subject when the action is missing', () => {
        expect(chunkLaneOpener('')).toMatch(/^This action is too large/);
        expect(chunkLaneOpener(null)).toMatch(/^This action is too large/);
        expect(chunkLaneOpener(undefined)).toMatch(/^This action is too large/);
    });
});

describe('signerSubject', () => {
    it.each([
        ['ledger', 'A Ledger'],
        ['TREZOR', 'A Trezor'],
        ['Multisig', 'A multisig signer'],
        ['AIRGAP', 'An air-gapped signer'],
    ])('names the %s signer in user-facing terms', (kind, expected) => {
        expect(signerSubject(kind)).toBe(expected);
    });

    it('uses a generic subject for missing and unknown signer kinds', () => {
        expect(signerSubject('remote')).toBe('This signer');
        expect(signerSubject('__proto__')).toBe('This signer');
        expect(signerSubject('')).toBe('This signer');
        expect(signerSubject(null)).toBe('This signer');
        expect(signerSubject(undefined)).toBe('This signer');
    });
});

describe('CHUNK_LANE_OPENER_RE', () => {
    it('recognizes generated openers inside complete refusal messages', () => {
        const message = `${chunkLaneOpener('MINT')}, and this signer cannot finish it.`;
        expect(CHUNK_LANE_OPENER_RE.test(message)).toBe(true);
    });

    it('does not accept similar wording that lacks the linked-transaction refusal', () => {
        expect(CHUNK_LANE_OPENER_RE.test(
            'This Mint action is too large for one transaction: try again later',
        )).toBe(false);
        expect(CHUNK_LANE_OPENER_RE.test('')).toBe(false);
    });
});
