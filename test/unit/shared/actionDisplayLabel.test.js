// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: shared/utils/actionDisplayLabel. Maps a raw protocol ACTION verb
// (any case) to a plain-language label, resolving both wire names
// (ISSUE) and lower-case UI kinds (issue, crosschain) through the same
// upper-cased map, and humanizing unknown verbs rather than leaking
// all-caps jargon.

import { describe, it, expect } from 'vitest';
import { actionDisplayLabel } from '../../../packages/core/src/shared/utils/actionDisplayLabel.js';

describe('shared/actionDisplayLabel', () => {
    it('maps known protocol verbs to their display label', () => {
        expect(actionDisplayLabel('SEND')).toBe('Send');
        expect(actionDisplayLabel('ISSUE')).toBe('Issue');
        expect(actionDisplayLabel('COINPAY')).toBe('Coin payment');
        expect(actionDisplayLabel('EXECUTE')).toBe('Contract call');
    });

    it('resolves lower-case UI kinds through the same map', () => {
        expect(actionDisplayLabel('issue')).toBe('Issue');
        expect(actionDisplayLabel('crosschain')).toBe('Cross-chain');
    });

    it('maps ADDRESS, VOTE, and DEPLOY to humanized phrases (not the bare opcode)', () => {
        expect(actionDisplayLabel('ADDRESS')).toBe('Messaging setup');
        expect(actionDisplayLabel('VOTE')).toBe('Vote');
        expect(actionDisplayLabel('DEPLOY')).toBe('Publish contract');
    });

    it('maps validator and mirror-injected verbs, not the recased opcode', () => {
        expect(actionDisplayLabel('ANCHOR')).toBe('Network checkpoint');
        expect(actionDisplayLabel('ATTEST')).toBe('Validator attestation');
        expect(actionDisplayLabel('NODEPROOF')).toBe('Node proof');
        expect(actionDisplayLabel('SLASH')).toBe('Validator penalty');
        expect(actionDisplayLabel('XCALL')).toBe('Cross-chain call');
        expect(actionDisplayLabel('XEXEC')).toBe('Cross-chain execution');
        expect(actionDisplayLabel('CROSS_SETTLE')).toBe('Cross-chain settlement');
        // The Title-Case fallback used to produce these; assert it no longer does.
        expect(actionDisplayLabel('XCALL')).not.toBe('Xcall');
        expect(actionDisplayLabel('NODEPROOF')).not.toBe('Nodeproof');
        expect(actionDisplayLabel('CROSS_SETTLE')).not.toBe('Cross settle');
    });

    it('maps both LINK and CROSSCHAIN to the same cross-chain label', () => {
        expect(actionDisplayLabel('LINK')).toBe('Cross-chain');
        expect(actionDisplayLabel('CROSSCHAIN')).toBe('Cross-chain');
    });

    it('trims surrounding whitespace before lookup', () => {
        expect(actionDisplayLabel('  MINT  ')).toBe('Mint');
    });

    it('humanizes an unknown verb (Title Case, underscores/hyphens to spaces)', () => {
        expect(actionDisplayLabel('FOO_BAR')).toBe('Foo bar');
        expect(actionDisplayLabel('some-new-action')).toBe('Some new action');
        expect(actionDisplayLabel('WIDGET')).toBe('Widget');
    });

    it('returns an empty string for falsy input', () => {
        expect(actionDisplayLabel('')).toBe('');
        expect(actionDisplayLabel(null)).toBe('');
        expect(actionDisplayLabel(undefined)).toBe('');
    });
});
