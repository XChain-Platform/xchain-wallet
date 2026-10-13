// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from './Button.jsx';

const DENIED_MESSAGE = 'Clipboard access was denied. Paste manually instead.';
const UNAVAILABLE_MESSAGE = 'Clipboard access is unavailable. Paste manually instead.';

/**
 * Reads plain text from the clipboard after a user click and passes a trimmed
 * value to the field that owns the button.
 *
 * @param {object} props
 * @param {(text: string) => void | Promise<void>} props.onPaste
 * @param {boolean} [props.disabled]
 * @param {string} [props.label]
 */
export function ClipboardPasteButton({ onPaste, disabled = false, label = 'Paste from clipboard' }) {
    const [message, setMessage] = useState('');

    const paste = async () => {
        const readText = globalThis.navigator?.clipboard?.readText;
        if (typeof readText !== 'function') {
            setMessage(UNAVAILABLE_MESSAGE);
            return;
        }

        let value;
        try {
            value = await readText.call(globalThis.navigator.clipboard);
        } catch {
            setMessage(DENIED_MESSAGE);
            return;
        }

        await onPaste(typeof value === 'string' ? value.trim() : '');
        setMessage('');
    };

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexWrap: 'wrap' }}>
            <Button
                variant="ghost"
                size="sm"
                onClick={paste}
                disabled={disabled}
                aria-label={label}
            >
                Paste
            </Button>
            {message ? (
                <span role="alert" style={{ color: 'var(--xc-danger-fg)', fontSize: 'var(--xc-text-xs)' }}>
                    {message}
                </span>
            ) : null}
        </span>
    );
}
