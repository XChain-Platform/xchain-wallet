// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';
import { ResultScreen } from '../../../packages/core/src/shared/components/ResultScreen.jsx';
import * as clipboard from '../../../packages/core/src/shared/clipboard.js';

let writeText;

beforeEach(() => {
    writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete navigator.clipboard;
});

describe('clipboard control feedback', () => {
    it('confirms a successful watcher transaction copy inline', async () => {
        writeText.mockResolvedValueOnce(undefined);
        render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect((await screen.findAllByText('Copied: unsigned transaction hex')).length).toBeGreaterThan(0);
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when raw transaction copying is unavailable', async () => {
        render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when watcher transaction copying is unavailable', async () => {
        render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: the clipboard is unavailable.')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('renders watcher copy and transaction fields with style-guide controls', () => {
        render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        expect(screen.getByRole('textbox', { name: 'Unsigned transaction hex' }).className)
            .toMatch(/input/);
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }).className)
            .toMatch(/btn/);
        expect(screen.getByRole('radiogroup', { name: 'Animated QR format' }))
            .toBeInTheDocument();
        const xcw = screen.getByRole('radio', { name: 'XCW (this wallet)' });
        const bbqr = screen.getByRole('radio', {
            name: 'BBQr (Sparrow / Coldcard / SeedSigner)',
        });
        expect(xcw).toBeChecked();
        fireEvent.click(bbqr);
        expect(bbqr).toBeChecked();
    });

    it('ignores a copy result after the transaction payload changes', async () => {
        let resolveCopy;
        vi.spyOn(clipboard, 'copyText').mockReturnValueOnce(new Promise((resolve) => {
            resolveCopy = resolve;
        }));
        const { rerender } = render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        rerender(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        await act(async () => resolveCopy({ ok: true }));

        expect(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }))
            .toHaveTextContent('Copy hex');
    });

    it('resets shared copy feedback when the transaction payload changes', async () => {
        writeText.mockResolvedValue(undefined);
        const { rerender } = render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));
        expect((await screen.findAllByText('Copied: unsigned transaction hex')).length).toBeGreaterThan(0);

        rerender(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }))
            .toHaveTextContent('Copy hex');
    });
});
