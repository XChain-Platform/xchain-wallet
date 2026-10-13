// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell crash hooks: a thrown error reaches the shell's ring buffer.

import { describe, it, expect } from 'vitest';
import { installShellErrorCapture, getRecentShellErrors } from '../../../packages/web/src/errorCapture.js';
import { installShellErrorCapture as installDesktop } from '../../../packages/desktop/renderer/errorCapture.js';
import { installShellErrorCapture as installPopup } from '../../../packages/extension/src/popup/errorCapture.js';

describe('shell crash hook', () => {
    it('captures window error events', () => {
        const off = installShellErrorCapture();
        window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('bad range'), message: 'bad range' }));
        expect(getRecentShellErrors().some((e) => e.kind === 'RangeError')).toBe(true);
        off();
    });

    it('exposes the hook in desktop and popup shells', () => {
        expect(installDesktop()).toBeTypeOf('function');
        expect(installPopup()).toBeTypeOf('function');
    });
});
