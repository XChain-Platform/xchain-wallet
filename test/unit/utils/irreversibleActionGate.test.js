// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { irreversibleConfirmWord } from '../../../packages/core/src/shared/utils/irreversibleActionGate.js';

describe('irreversibleConfirmWord', () => {
    it('asks for DESTROY on every destroy', () => {
        expect(irreversibleConfirmWord('DESTROY', { TICK: 'A', AMOUNT: '1' })).toBe('DESTROY');
    });

    it('asks for LOCK when an ISSUE sets any lock flag', () => {
        expect(irreversibleConfirmWord('ISSUE', { VERSION: '3', TICK: 'A', LOCK_DESCRIPTION: '1' })).toBe('LOCK');
        expect(irreversibleConfirmWord('ISSUE', { VERSION: '3', TICK: 'A', LOCK_BRIDGE: '1' })).toBe('LOCK');
    });

    it('asks for nothing on an ISSUE that sets no lock flag', () => {
        expect(irreversibleConfirmWord('ISSUE', { VERSION: '2', TICK: 'A', MAX_MINT: '5', LOCK_MINT: '' })).toBeNull();
        expect(irreversibleConfirmWord('ISSUE', { VERSION: '3', TICK: 'A', LOCK_MINT: '0' })).toBeNull();
    });

    it('asks for LOCK on an address lock but not on a resume or a token pause', () => {
        expect(irreversibleConfirmWord('SLEEP', { VERSION: '0', RESUME_BLOCK: '-1' })).toBe('LOCK');
        expect(irreversibleConfirmWord('SLEEP', { VERSION: '0', RESUME_BLOCK: '900000' })).toBe('LOCK');
        expect(irreversibleConfirmWord('SLEEP', { RESUME_BLOCK: '-1' })).toBe('LOCK');
        expect(irreversibleConfirmWord('SLEEP', { VERSION: '0', RESUME_BLOCK: '0' })).toBeNull();
        expect(irreversibleConfirmWord('SLEEP', { VERSION: '1', TICK: 'A', RESUME_BLOCK: '-1' })).toBeNull();
    });

    it('asks for nothing on other actions or missing params', () => {
        expect(irreversibleConfirmWord('SEND', { TICK: 'A' })).toBeNull();
        expect(irreversibleConfirmWord('DESTROY2', null)).toBeNull();
    });
});
