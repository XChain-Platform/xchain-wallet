// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first, slice 2: the help dot grew a target without
// losing its name.
//
// The fix moved the painted circle off the <button> and onto an inner
// <span>, so the button could grow to the 24px pointer-target floor while
// the dot still looks like a 16px dot. The hazard in that shape is an
// accessibility one, not a visual one: a decorative inner span that
// forgot `aria-hidden` would put a stray "?" into the accessible name,
// and every screen reader would announce "Fee priority help question
// mark". jsdom cannot check the 24px (it performs no layout - the live
// proof is test/e2e/tests/responsive/viewports.spec.js), but it can check
// that the name survived the surgery.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';

describe('InfoTip target (slice 2)', () => {
    afterEach(cleanup);

    it('keeps the trigger\'s accessible name exactly its aria label', () => {
        render(<InfoTip aria="Fee priority help" label="How fees work" />);
        const trigger = screen.getByRole('button', { name: 'Fee priority help' });
        expect(trigger).toBeTruthy();
        // Exact, not substring: the glyph must not leak "?" into the name.
        expect(trigger.getAttribute('aria-label')).toBe('Fee priority help');
    });

    it('paints the dot in an aria-hidden glyph inside the button', () => {
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        const glyph = trigger.querySelector('[aria-hidden="true"]');
        expect(glyph, 'the painted dot is a child of the target, not the target itself').toBeTruthy();
        expect(glyph.textContent).toBe('?');
    });

    it('still opens its bubble on click', () => {
        render(<InfoTip aria="More info" label="Explanation" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole('tooltip').textContent).toBe('Explanation');
    });
});
