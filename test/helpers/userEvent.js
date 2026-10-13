// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent } from '@testing-library/react';

const FOCUSABLE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[tabindex]',
].join(',');

function focusableElements() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter((element) => (
        !element.disabled
        && !element.hidden
        && !element.closest('[inert]')
        && element.getAttribute('aria-hidden') !== 'true'
        && Number(element.getAttribute('tabindex') ?? 0) >= 0
    ));
}

function pressKey(key, init = {}) {
    const target = document.activeElement || document.body;
    const proceeds = fireEvent.keyDown(target, { key, ...init });
    fireEvent.keyUp(target, { key, ...init });
    if (!proceeds || key !== 'Enter') return;

    if (target instanceof HTMLButtonElement) {
        target.click();
        return;
    }
    if (target instanceof HTMLTextAreaElement) return;
    const form = target.closest?.('form');
    if (form) form.requestSubmit();
}

function typeText(text) {
    for (const character of text) {
        const target = document.activeElement;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
            return;
        }
        const proceeds = fireEvent.keyDown(target, { key: character });
        if (proceeds) {
            const start = target.selectionStart ?? target.value.length;
            const end = target.selectionEnd ?? start;
            fireEvent.change(target, {
                target: { value: `${target.value.slice(0, start)}${character}${target.value.slice(end)}` },
            });
            target.setSelectionRange(start + character.length, start + character.length);
        }
        fireEvent.keyUp(target, { key: character });
    }
}

function moveFocus(backward = false) {
    const target = document.activeElement || document.body;
    const proceeds = fireEvent.keyDown(target, { key: 'Tab', shiftKey: backward });
    if (!proceeds) return;
    const elements = focusableElements();
    const current = elements.indexOf(target);
    const next = backward
        ? (current <= 0 ? elements.at(-1) : elements[current - 1])
        : (current < 0 || current === elements.length - 1 ? elements[0] : elements[current + 1]);
    next?.focus();
    fireEvent.keyUp(next || target, { key: 'Tab', shiftKey: backward });
}

/**
 * Minimal keyboard driver for tests that need browser-like Enter and Tab defaults.
 */
export const userEvent = {
    setup() {
        return {
            async keyboard(sequence) {
                for (const token of sequence.match(/\{[^}]+\}|./g) || []) {
                    if (token === '{Enter}') pressKey('Enter');
                    else if (token === '{Escape}') pressKey('Escape');
                    else if (token === '{Tab}') moveFocus(false);
                    else pressKey(token);
                }
            },
            async tab({ shift = false } = {}) {
                moveFocus(shift);
            },
            async type(text) {
                typeText(text);
            },
        };
    },
};
