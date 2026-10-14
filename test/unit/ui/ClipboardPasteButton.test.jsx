// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClipboardPasteButton } from '../../../packages/core/src/ui/ClipboardPasteButton.jsx';

function setClipboard(clipboard) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: clipboard,
        configurable: true,
    });
}

afterEach(() => {
    delete globalThis.navigator.clipboard;
});

describe('<ClipboardPasteButton>', () => {
    it('renders an accessible button and passes trimmed clipboard text to its owner', async () => {
        const clipboard = { readText: vi.fn().mockResolvedValue('  bc1qwallet\n') };
        const onPaste = vi.fn().mockResolvedValue(undefined);
        setClipboard(clipboard);

        render(<ClipboardPasteButton onPaste={onPaste} />);

        const button = screen.getByRole('button', { name: 'Paste from clipboard' });
        expect(button).toHaveTextContent('Paste');
        fireEvent.click(button);

        await waitFor(() => {
            expect(onPaste).toHaveBeenCalledWith('bc1qwallet');
        });
        expect(clipboard.readText).toHaveBeenCalledOnce();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('uses its custom accessible label and stays inert while disabled', () => {
        const clipboard = { readText: vi.fn().mockResolvedValue('secret') };
        const onPaste = vi.fn();
        setClipboard(clipboard);

        render(
            <ClipboardPasteButton
                onPaste={onPaste}
                disabled
                label="Paste recovery phrase from clipboard"
            />,
        );

        const button = screen.getByRole('button', { name: 'Paste recovery phrase from clipboard' });
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(clipboard.readText).not.toHaveBeenCalled();
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('announces denied clipboard access without calling its owner', async () => {
        const onPaste = vi.fn();
        setClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) });

        render(<ClipboardPasteButton onPaste={onPaste} />);
        fireEvent.click(screen.getByRole('button'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Clipboard access was denied. Paste manually instead.',
        );
        expect(onPaste).not.toHaveBeenCalled();
    });

    it('announces an unavailable clipboard and normalizes non-text values', async () => {
        const onPaste = vi.fn();
        setClipboard(undefined);
        const view = render(<ClipboardPasteButton onPaste={onPaste} />);

        fireEvent.click(screen.getByRole('button'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Clipboard access is unavailable. Paste manually instead.',
        );

        setClipboard({ readText: vi.fn().mockResolvedValue(null) });
        view.rerender(<ClipboardPasteButton onPaste={onPaste} />);
        fireEvent.click(screen.getByRole('button'));

        await waitFor(() => {
            expect(onPaste).toHaveBeenCalledWith('');
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
