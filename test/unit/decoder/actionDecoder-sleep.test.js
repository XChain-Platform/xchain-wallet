// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (xchain-wallet#41) The SLEEP summary on the approval screen described an
// address self-lock (v0, no TICK) as "Pause token activity until block -1"
// with a token-transfer warning, which misstates an irreversible lock of the
// signer's own address. Seen by addresses/sleep-self-lock.regtest.spec.js.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

describe('SLEEP decoder summary', () => {
    it('names an indefinite address lock as a lock of this address', () => {
        const out = decodeAction({ action: 'SLEEP', params: { VERSION: '0', RESUME_BLOCK: '-1' } });
        expect(out.summary).toBe('Lock this address indefinitely');
        expect(out.warnings.join(' ')).not.toMatch(/token/);
    });

    it('names a timed address lock with its resume block', () => {
        const out = decodeAction({ action: 'SLEEP', params: { VERSION: '0', RESUME_BLOCK: '900000' } });
        expect(out.summary).toBe('Lock this address until block 900000');
    });

    it('keeps the token wording for a tick sleep', () => {
        const out = decodeAction({ action: 'SLEEP', params: { VERSION: '1', RESUME_BLOCK: '-1', TICK: 'JDOG' } });
        expect(out.summary).toBe('Pause JDOG indefinitely');
        expect(out.warnings[0]).toMatch(/affected token/);
    });

    it('reads RESUME_BLOCK 0 as a resume', () => {
        const out = decodeAction({ action: 'SLEEP', params: { VERSION: '1', RESUME_BLOCK: '0', TICK: 'JDOG' } });
        expect(out.summary).toBe('Resume JDOG');
    });
});
