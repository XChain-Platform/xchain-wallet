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

        const transaction = screen.getByRole('textbox', { name: 'Unsigned transaction code' });
        const copy = screen.getByRole('button', { name: 'Copy unsigned transaction code' });
        expect(transaction.parentElement).toContainElement(copy);
        expect(copy).toHaveTextContent('');
        fireEvent.click(copy);

        expect((await screen.findAllByText('Copied: unsigned transaction code')).length).toBeGreaterThan(0);
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when raw transaction copying is unavailable', async () => {
        render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy Unsigned Transaction Code' }));

        expect(await screen.findByText('Copy Failed: Clipboard Unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when watcher transaction copying is unavailable', async () => {
        render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction code' }));

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

        expect(screen.getByRole('textbox', { name: 'Unsigned transaction code' }).className)
            .toMatch(/input/);
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction code' }).className)
            .toMatch(/btn/);
        // QR format is the themed dropdown with an icon per option (G119).
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        const format = screen.getByRole('button', { name: 'QR format: XCW (this wallet)' });
        expect(format).toHaveAttribute('aria-haspopup', 'listbox');
        expect(format.querySelector('svg')).not.toBeNull();
        fireEvent.click(format);
        fireEvent.click(screen.getByRole('option', { name: 'BBQr (Sparrow / Coldcard / SeedSigner)' }));
        expect(screen.getByRole('button', { name: 'QR format: BBQr (Sparrow / Coldcard / SeedSigner)' }))
            .toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction code' }));

        rerender(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        await act(async () => resolveCopy({ ok: true }));

        expect(screen.getByRole('button', { name: 'Copy unsigned transaction code' }))
            .toHaveAttribute('data-state', 'idle');
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction code' }))
            .toHaveTextContent('');
    });

    it('resets shared copy feedback when the transaction payload changes', async () => {
        writeText.mockResolvedValue(undefined);
        const { rerender } = render(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction code' }));
        expect((await screen.findAllByText('Copied: unsigned transaction code')).length).toBeGreaterThan(0);

        rerender(
            <ResultScreen state="unsigned"
                result={{ psbtHex: 'cafebabe' }}
                onDone={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction code' }))
            .toHaveAttribute('data-state', 'idle');
        expect(screen.getByRole('button', { name: 'Copy unsigned transaction code' }))
            .toHaveTextContent('');
    });
});
