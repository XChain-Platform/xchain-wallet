// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DurationSlider } from '../../../packages/core/src/shared/components/DurationSlider.jsx';

const cssPath = resolve(
    process.cwd(),
    'packages/core/src/shared/components/DurationSlider.module.css',
);

afterEach(cleanup);

describe('DurationSlider layout and supporting text', () => {
    it('stacks each preset time and block count in the Button label wrapper', () => {
        render(<DurationSlider coin="bitcoin" value="144" onChange={() => {}} />);

        for (const [time, blocks] of [
            ['1 hour', '6 blocks'],
            ['1 day', '144 blocks'],
            ['1 week', '1,008 blocks'],
            ['1 month', '4,320 blocks'],
        ]) {
            const timeNode = screen.getByText(time);
            const blocksNode = screen.getByText(blocks);
            const buttonLabel = timeNode.parentElement;
            expect(timeNode.tagName).toBe('SPAN');
            expect(blocksNode.tagName).toBe('SPAN');
            // The full "N blocks" line and the bare number for a narrow
            // slider share the second line under the time.
            const blocksLine = blocksNode.parentElement;
            expect(blocksLine?.parentElement).toBe(buttonLabel);
            expect(blocksLine?.lastElementChild?.textContent).toBe(blocks.replace(/ blocks?$/, ''));
            expect(buttonLabel?.parentElement?.tagName).toBe('BUTTON');
        }
        const sheet = readFileSync(cssPath, 'utf8');
        expect(sheet).toMatch(/\.blocksShort\s*{\s*display:\s*none;/);
        expect(sheet).toMatch(/@container \(max-width: 440px\)\s*{[^@]*\.blocksFull\s*{\s*display:\s*none;[^@]*\.blocksShort\s*{\s*display:\s*inline;/s);

        const css = readFileSync(cssPath, 'utf8');
        expect(css).toMatch(/\.sliderTick\s*>\s*span:last-child\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
        expect(css).toMatch(/\.sliderTickTime,\s*\.sliderTickBlocks\s*{[^}]*display:\s*block;/s);
        expect(css).toContain('max-width: 23%');
        expect(css).toContain('.sliderTick.sliderTick:first-child { transform: translateX(0); }');
        expect(css).toContain('.sliderTick.sliderTick:last-child { transform: translateX(-100%); }');
    });

    it('shows only the end-block result below a preset and one duration hint for Custom', () => {
        function ControlledSlider() {
            const [value, setValue] = useState('144');
            return (
                <DurationSlider
                    coin="bitcoin"
                    value={value}
                    onChange={setValue}
                    wakeText="Ends at block 10,144, est. Nov 11, 2026"
                />
            );
        }

        render(<ControlledSlider />);

        expect(screen.getByText('Ends at block 10,144, est. Nov 11, 2026')).toBeInTheDocument();
        expect(screen.queryByText('144 blocks is ~1 day (1 block is ~10 min).')).toBeNull();

        fireEvent.click(screen.getByText('Custom'));
        fireEvent.change(screen.getByLabelText('Blocks'), { target: { value: '100' } });

        expect(screen.getAllByText('100 blocks is ~16.7 hours (1 block is ~10 min).')).toHaveLength(1);
        expect(screen.getByText('Ends at block 10,144, est. Nov 11, 2026')).toBeInTheDocument();
    });
});
