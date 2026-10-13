// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    reducedMotion: false,
    toDataURL: vi.fn(),
}));

vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }));
vi.mock('../../../packages/core/src/ui/reducedMotion.js', () => ({
    useReducedMotion: () => mocks.reducedMotion,
}));

import { AnimatedQrFrames } from '../../../packages/core/src/ui/AnimatedQrFrames.jsx';

async function flushQrRendering() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('<AnimatedQrFrames>', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.reducedMotion = false;
        mocks.toDataURL.mockReset();
        mocks.toDataURL.mockImplementation(async (value) => `data:image/png,${value}`);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('advances at the requested cadence and pauses and resumes without losing the frame', async () => {
        render(<AnimatedQrFrames frames={['one', 'two']} fps={2} alt="Signing QR" />);
        await flushQrRendering();

        expect(screen.getByText('Frame 1 / 2 · 2 fps')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Signing QR, frame 1 of 2' })).toHaveAttribute(
            'src',
            'data:image/png,one',
        );

        act(() => vi.advanceTimersByTime(499));
        expect(screen.getByText('Frame 1 / 2 · 2 fps')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByText('Frame 2 / 2 · 2 fps')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Signing QR, frame 2 of 2' })).toHaveAttribute(
            'src',
            'data:image/png,two',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
        expect(screen.getByText('Frame 2 / 2 · manual')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByText('Frame 2 / 2 · manual')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Resume animation' }));
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByText('Frame 1 / 2 · 2 fps')).toBeInTheDocument();
    });

    it('uses manual stepping whenever reduced motion is enabled', async () => {
        mocks.reducedMotion = true;
        render(<AnimatedQrFrames frames={['one', 'two']} fps={10} />);
        await flushQrRendering();

        expect(screen.queryByRole('button', { name: 'Pause animation' })).not.toBeInTheDocument();
        expect(screen.getByText('Frame 1 / 2 · manual')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByText('Frame 1 / 2 · manual')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
        expect(screen.getByText('Frame 2 / 2 · manual')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Previous frame' }));
        expect(screen.getByText('Frame 1 / 2 · manual')).toBeInTheDocument();
    });

    it('restarts a replacement frame set without displaying a stale QR or counter', async () => {
        const view = render(<AnimatedQrFrames frames={['old-one', 'old-two']} fps={2} />);
        await flushQrRendering();
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByText('Frame 2 / 2 · 2 fps')).toBeInTheDocument();

        view.rerender(<AnimatedQrFrames frames={['new-only']} fps={2} />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        await flushQrRendering();

        expect(screen.getByText('Frame 1 / 1')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Animated QR, frame 1 of 1' })).toHaveAttribute(
            'src',
            'data:image/png,new-only',
        );
    });

    it('renders high-contrast responsive QR images with a white quiet zone', async () => {
        render(<AnimatedQrFrames frames={['payload']} size={320} />);
        await flushQrRendering();

        expect(mocks.toDataURL).toHaveBeenCalledWith('payload', expect.objectContaining({
            margin: 4,
            width: 320,
            color: { dark: '#000000', light: '#FFFFFF' },
        }));
        const image = screen.getByRole('img');
        expect(image).toHaveStyle({ width: '100%', maxWidth: '320px', height: 'auto' });
        expect(image).toHaveStyle({ background: '#FFFFFF' });
        expect(mocks.toDataURL).toHaveBeenCalledTimes(1);
    });
});
