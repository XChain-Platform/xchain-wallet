// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The fee tier stops and the click-to-edit fee figures are native buttons, so
// they carry the shared Button base, one variant and one size class beside
// their own FeeSelector classes, which keep the tick and readout geometry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import styles from '../../../packages/core/src/ui/FeeSelector.module.css';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const estimate = (rateValue, coinAmount, etaMinutes) => ({
    rateValue,
    rate: `${rateValue} sat/vB`,
    coinAmount,
    etaMinutes,
    unit: 'sat/vB',
    vsize: 250,
});

const tiers = {
    low: estimate(1, '0.00000250', 60),
    normal: estimate(6, '0.00001500', 30),
    fast: estimate(12, '0.00003000', 10),
    unit: 'sat/vB',
    minimumRate: 1,
};

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
const SIZES = ['sm', 'md', 'lg'];

afterEach(cleanup);

function ControlledSelector({ initialValue, ...props }) {
    const [value, setValue] = useState(initialValue);
    return <FeeSelector tiers={tiers} value={value} onChange={setValue} {...props} />;
}

function expectButtonBase(button) {
    expect(button).toHaveClass(buttonStyles.btn, buttonStyles.ghost, buttonStyles.sm);
    const classes = button.className.split(/\s+/);
    expect(VARIANTS.filter((v) => classes.includes(buttonStyles[v]))).toEqual(['ghost']);
    expect(SIZES.filter((s) => classes.includes(buttonStyles[s]))).toEqual(['sm']);
}

function ticks() {
    return ['Slow', 'Normal', 'Fast', 'Custom']
        .map((label) => document.querySelector(`button[aria-label="${label}"]`));
}

describe('FeeSelector buttons carry the shared Button base', () => {
    it('gives every tier stop and both readout figures btn, ghost and sm in slider mode', () => {
        render(<ControlledSelector initialValue={{ mode: 'normal' }} />);

        const stops = ticks();
        expect(stops.every(Boolean)).toBe(true);
        for (const stop of stops) {
            expectButtonBase(stop);
            expect(stop).toHaveClass(styles.sliderTick);
        }
        expect(stops[1]).toHaveClass(styles.sliderTickActive);
        expect(stops[0]).not.toHaveClass(styles.sliderTickActive);

        const amount = document.querySelector('button[aria-label="Edit exact fee amount"]');
        const rate = document.querySelector('button[aria-label="Edit fee rate (sat/vB)"]');
        expectButtonBase(amount);
        expect(amount).toHaveClass(styles.readoutEdit);
        expectButtonBase(rate);
        expect(rate).toHaveClass(styles.readoutEdit, styles.sliderReadoutRate);
    });

    it('keeps the base on the stops and the fee figure in custom mode', () => {
        render(
            <ControlledSelector
                initialValue={{ mode: 'custom', customRate: 4 }}
                customEstimate={{ rate: '4 sat/vB', rateValue: 4, coinAmount: '0.00000400', vsize: 100 }}
            />,
        );

        const stops = ticks();
        for (const stop of stops) {
            expectButtonBase(stop);
            expect(stop).toHaveClass(styles.sliderTick);
        }
        expect(stops[3]).toHaveClass(styles.sliderTickActive);

        const amount = document.querySelector('button[aria-label="Edit exact fee amount"]');
        expectButtonBase(amount);
        expect(amount).toHaveClass(styles.readoutEdit);
    });

    it('keeps the base on the rate figure while the fee amount is open for editing', () => {
        render(<ControlledSelector initialValue={{ mode: 'fast' }} />);

        fireEvent.click(document.querySelector('button[aria-label="Edit exact fee amount"]'));
        expect(document.querySelector('button[aria-label="Edit exact fee amount"]')).toBeNull();
        expect(document.querySelector('input[aria-label="Network fee amount"]')).not.toBeNull();

        const rate = document.querySelector('button[aria-label="Edit fee rate (sat/vB)"]');
        expectButtonBase(rate);
        expect(rate).toHaveClass(styles.readoutEdit, styles.sliderReadoutRate);
        for (const stop of ticks()) expectButtonBase(stop);
    });

    it('applies the base in markup and loads it ahead of the FeeSelector sheet', () => {
        const jsx = readFileSync(join(ROOT, 'packages/core/src/ui/FeeSelector.jsx'), 'utf8');
        const css = readFileSync(join(ROOT, 'packages/core/src/ui/FeeSelector.module.css'), 'utf8');
        const buttonImport = jsx.indexOf("import buttonStyles from './Button.module.css';");
        const ownImport = jsx.indexOf("import styles from './FeeSelector.module.css';");
        expect(buttonImport).toBeGreaterThan(-1);
        expect(buttonImport).toBeLessThan(ownImport);
        expect(css).not.toMatch(/composes:/);
    });
});
