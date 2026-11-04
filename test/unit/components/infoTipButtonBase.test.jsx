// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The InfoTip help dot is a real button, so it carries the shared Button
// base class like every other button in the wallet, with one variant (link,
// transparent in every state) and one size (sm). Its own .trigger rules
// load after the base and keep the 16px glyph inside a tap-sized box. The
// base comes in through a JS import, never a CSS `composes`, which would
// inline a second copy of Button.module.css into the InfoTip sheet.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InfoTip } from '../../../packages/core/src/ui/InfoTip.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import infoTipStyles from '../../../packages/core/src/ui/InfoTip.module.css';

const infoTipCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/InfoTip.module.css'),
    'utf8',
);
const infoTipSource = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/InfoTip.jsx'),
    'utf8',
);

afterEach(cleanup);

describe('InfoTip trigger uses the shared Button base', () => {
    it('renders the trigger with the Button btn, link and sm classes and its own trigger class', () => {
        render(<InfoTip label="x" />);
        const trigger = screen.getByRole('button', { name: 'More info' });
        expect(buttonStyles.btn).toBeTruthy();
        expect(trigger).toHaveClass(buttonStyles.btn, buttonStyles.link, buttonStyles.sm, infoTipStyles.trigger);
        expect(trigger.getAttribute('type')).toBe('button');
    });

    it('loads the Button sheet ahead of the InfoTip sheet', () => {
        const buttonImport = infoTipSource.indexOf("from './Button.module.css'");
        const ownImport = infoTipSource.indexOf("from './InfoTip.module.css'");
        expect(buttonImport).toBeGreaterThan(-1);
        expect(buttonImport).toBeLessThan(ownImport);
    });

    it('never composes from the Button sheet in CSS', () => {
        expect(infoTipCss).not.toMatch(/composes:[^;]*Button/);
        expect(infoTipCss).not.toMatch(/composes:/);
    });

    it('resets the Button base box on the trigger so the glyph keeps its size', () => {
        const trigger = infoTipCss.match(/\n\.trigger \{([^}]*)\}/);
        expect(trigger).not.toBeNull();
        const body = trigger[1];
        for (const rule of [
            /min-width:\s*var\(--xc-tap-min\)/,
            /min-height:\s*var\(--xc-tap-min\)/,
            /padding:\s*0/,
            /border:\s*none/,
            /background:\s*transparent/,
            /gap:\s*0/,
            /font-size:\s*11px/,
            /font-weight:\s*700/,
            /line-height:\s*1;/,
            /border-radius:/,
            /text-decoration:\s*none/,
        ]) {
            expect(body).toMatch(rule);
        }
    });
});
