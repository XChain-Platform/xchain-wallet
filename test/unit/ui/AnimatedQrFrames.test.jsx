// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QRCode from 'qrcode';
import { AnimatedQrFrames } from '../../../packages/core/src/ui/AnimatedQrFrames.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn((value) => Promise.resolve(`data:image/png,${value}`)) },
}));

vi.mock('../../../packages/core/src/ui/reducedMotion.js', () => ({
    useReducedMotion: () => true,
}));

describe('<AnimatedQrFrames>', () => {
    beforeEach(() => {
        QRCode.toDataURL.mockClear();
    });

    it('renders nothing and does not encode when no frames exist', () => {
        const { container } = render(<AnimatedQrFrames frames={[]} />);
        expect(container).toBeEmptyDOMElement();
        expect(QRCode.toDataURL).not.toHaveBeenCalled();
    });

    it('encodes a single frame with the requested size and accessible name', async () => {
        render(<AnimatedQrFrames frames={['one']} size={180} alt="Signing payload" />);
        const region = screen.getByRole('img', { name: 'Signing payload (frame 1 of 1)' });
        expect(region).toHaveAttribute('data-reduced-motion', 'true');
        await waitFor(() => expect(region.querySelector('img')).toBeInTheDocument());
        expect(region.querySelector('img')).toHaveAttribute('width', '180');
        expect(QRCode.toDataURL).toHaveBeenCalledWith('one', expect.objectContaining({ width: 180 }));
        expect(screen.queryByRole('button', { name: /frame/ })).not.toBeInTheDocument();
    });

    it('offers manual navigation for multiple frames under reduced motion', async () => {
        render(<AnimatedQrFrames frames={['one', 'two']} fps={4} alt="Signing payload" />);
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Signing payload (frame 1 of 2; advance manually)',
        );
        expect(screen.getByText('Frame 1 / 2 · manual')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Signing payload (frame 2 of 2; advance manually)',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Previous frame' }));
        expect(screen.getByRole('img')).toHaveAccessibleName(
            'Signing payload (frame 1 of 2; advance manually)',
        );
        await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledWith(
            'two', expect.objectContaining({ width: 240 }),
        ));
    });

    it('resets to valid, freshly encoded content when the frame list changes', async () => {
        const { rerender } = render(
            <AnimatedQrFrames frames={['one', 'two']} alt="Signing payload" />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
        await waitFor(() => {
            expect(screen.getByRole('img').querySelector('img')).toHaveAttribute(
                'src', 'data:image/png,two',
            );
        });

        rerender(<AnimatedQrFrames frames={['replacement']} alt="Signing payload" />);
        expect(screen.getByRole('img')).toHaveAccessibleName('Signing payload (frame 1 of 1)');
        await waitFor(() => {
            expect(screen.getByRole('img').querySelector('img')).toHaveAttribute(
                'src', 'data:image/png,replacement',
            );
        });
    });
});
