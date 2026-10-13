// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClipboardPasteButton } from '../../../packages/core/src/ui/ClipboardPasteButton.jsx';

function setClipboard(clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: clipboard,
    });
}

afterEach(() => {
    cleanup();
    delete navigator.clipboard;
});

describe('ClipboardPasteButton', () => {
    it('reads, trims, and passes clipboard text after a click', async () => {
        const readText = vi.fn().mockResolvedValue('  signed payload\n');
        const onPaste = vi.fn().mockResolvedValue(undefined);
        setClipboard({ readText });
        render(<ClipboardPasteButton onPaste={onPaste} label="Paste signed payload" />);

        fireEvent.click(screen.getByRole('button', { name: 'Paste signed payload' }));

        await waitFor(() => expect(onPaste).toHaveBeenCalledWith('signed payload'));
        expect(readText).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reports unavailable clipboard access without calling onPaste', async () => {
        const onPaste = vi.fn();
        setClipboard(undefined);
        render(<ClipboardPasteButton onPaste={onPaste} />);

        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Clipboard access is unavailable. Paste manually instead.');
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('reports denied clipboard access without calling onPaste', async () => {
        const onPaste = vi.fn();
        setClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) });
        render(<ClipboardPasteButton onPaste={onPaste} />);

        fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Clipboard access was denied. Paste manually instead.');
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('does not read the clipboard while disabled', () => {
        const readText = vi.fn();
        const onPaste = vi.fn();
        setClipboard({ readText });
        render(<ClipboardPasteButton onPaste={onPaste} disabled />);

        const button = screen.getByRole('button', { name: 'Paste from clipboard' });
        expect(button).toBeDisabled();
        fireEvent.click(button);

        expect(readText).not.toHaveBeenCalled();
        expect(onPaste).not.toHaveBeenCalled();
    });
});
