// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
    DurationSlider,
    durationStopBlocks,
    humanSpan,
} from '../../../../packages/core/src/shared/components/DurationSlider.jsx';

afterEach(cleanup);

describe('DurationSlider', () => {
    it('converts each chain duration to whole blocks', () => {
        expect(durationStopBlocks('bitcoin')).toEqual({
            hour: 6, day: 144, week: 1008, month: 4320,
        });
        expect(durationStopBlocks('litecoin')).toEqual({
            hour: 24, day: 576, week: 4032, month: 17280,
        });
        expect(durationStopBlocks('dogecoin')).toEqual({
            hour: 60, day: 1440, week: 10080, month: 43200,
        });
        expect(humanSpan(1440)).toBe('1 day');
    });

    it('renders chain-aware stops, the active estimate, and the wake line', () => {
        render(
            <DurationSlider
                coin="bitcoin"
                value="144"
                onChange={() => {}}
                wakeText="Ends at block 871,234, est. Nov 12, 2026"
            />,
        );

        expect(screen.getByText('1,008 blocks')).toBeInTheDocument();
        expect(screen.getByText('~1 day')).toBeInTheDocument();
        expect(screen.getByText('Ends at block 871,234, est. Nov 12, 2026')).toBeInTheDocument();
        expect(screen.queryByText('144 blocks ~1 day')).toBeNull();
        expect(screen.getByRole('slider', { name: 'Duration' })).toHaveAttribute(
            'aria-valuetext',
            '1 day, 144 blocks',
        );
    });

    it('emits the one-day preset when the value starts empty', async () => {
        const onChange = vi.fn();
        render(<DurationSlider coin="bitcoin" value="" onChange={onChange} />);

        await waitFor(() => expect(onChange).toHaveBeenCalledWith('144'));
    });

    it('keeps a selected preset duration when the chain changes', async () => {
        const onChange = vi.fn();
        const view = render(<DurationSlider coin="bitcoin" value="144" onChange={onChange} />);
        await waitFor(() => expect(onChange).toHaveBeenCalledWith('144'));
        onChange.mockClear();

        view.rerender(<DurationSlider coin="litecoin" value="144" onChange={onChange} />);

        await waitFor(() => expect(onChange).toHaveBeenCalledWith('576'));
    });

    it('opens a custom block input with one chain-aware duration hint', () => {
        function ControlledSlider() {
            const [value, setValue] = useState('144');
            return <DurationSlider coin="bitcoin" value={value} onChange={setValue} />;
        }

        render(<ControlledSlider />);
        fireEvent.click(screen.getByText('Custom'));
        fireEvent.change(screen.getByLabelText('Blocks'), { target: { value: '100' } });

        expect(screen.getByText('100 blocks is ~16.7 hours (1 block is ~10 min).')).toBeInTheDocument();
        expect(screen.getAllByText(/100 blocks is ~/)).toHaveLength(1);
        expect(screen.getByText('~16.7 hours')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Duration' })).toHaveAttribute('aria-valuetext', 'Custom');
    });
});
