// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ default: { toDataURL } }));

import { KeyQR } from '../../../packages/core/src/shared/components/KeyQR.jsx';

describe('<KeyQR>', () => {
    beforeEach(() => toDataURL.mockReset());
    afterEach(cleanup);

    it('uses a responsive black-on-white QR with a four-module quiet zone', async () => {
        toDataURL.mockResolvedValue('data:image/png,key');
        render(<KeyQR value="key" size={200} alt="Private key QR" />);
        await act(async () => Promise.resolve());

        expect(toDataURL).toHaveBeenCalledWith('key', expect.objectContaining({
            margin: 4,
            width: 200,
            color: { dark: '#000000', light: '#FFFFFF' },
        }));
        const image = screen.getByRole('img', { name: 'Private key QR' });
        expect(image).toHaveStyle({ width: '100%', maxWidth: '200px', height: 'auto' });
        expect(image).toHaveStyle({ background: '#FFFFFF' });
    });

    it('hides the previous key while a replacement QR is encoding', async () => {
        let resolveReplacement;
        toDataURL
            .mockResolvedValueOnce('data:image/png,first')
            .mockImplementationOnce(() => new Promise((resolve) => { resolveReplacement = resolve; }));
        const view = render(<KeyQR value="first" />);
        await act(async () => Promise.resolve());
        expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png,first');

        view.rerender(<KeyQR value="replacement" />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();

        await act(async () => resolveReplacement('data:image/png,replacement'));
        expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png,replacement');
    });
});
