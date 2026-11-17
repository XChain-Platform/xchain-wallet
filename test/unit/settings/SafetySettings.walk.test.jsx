// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUTOLOCK_OPTIONS, autolockOptionLabel } from '../../../packages/core/src/shared/components/settings/SafetySection.jsx';
import { SettingsInlineRow } from '../../../packages/core/src/shared/components/settings/SettingsInlineRow.jsx';
import inlineStyles from '../../../packages/core/src/shared/components/settings/SettingsInlineRow.module.css';
import {
    TestSendThresholdInlineRow,
    normalizeTestSendAmount,
} from '../../../packages/core/src/shared/components/settings/SecurityPages.jsx';
import { selectOption, selectOptionLabels } from '../../helpers/selectOption.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function typeAmount(input, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const character of text) {
        const next = `${input.value}${character}`;
        setter.call(input, next);
        input.setSelectionRange(next.length, next.length);
        fireEvent(input, new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: character,
        }));
    }
}

function renderAutoLock() {
    const row = {
        id: 'security-autolock',
        title: 'Auto-lock',
        line: 'Lock after no activity for',
        control: {
            kind: 'select',
            value: (settings) => String(settings.autolockMinutes),
            options: () => AUTOLOCK_OPTIONS.map((option) => ({
                value: String(option.value),
                label: autolockOptionLabel(option, 'web'),
            })),
            patch: (value) => ({ autolockMinutes: Number(value) }),
        },
    };
    return render(
        <SettingsInlineRow
            row={row}
            settings={{ autolockMinutes: 15 }}
            update={vi.fn(async () => {})}
        />,
    );
}

function renderTestSend(update = vi.fn(async () => {})) {
    const row = {
        title: 'New-recipient test send',
        line: 'Suggest a small test send above',
        help: 'Choose the amount.',
    };
    render(
        <TestSendThresholdInlineRow
            row={row}
            settings={{ fiatCurrency: 'USD', grace: { testSendThresholdFiat: '0' } }}
            update={update}
        />,
    );
    selectOption(screen.getByRole('combobox', { name: row.title }), 'custom');
    return { input: screen.getByRole('textbox', { name: 'Custom amount (USD)' }), update };
}

describe('Settings Safety walk fixes', () => {
    it('keeps Auto-lock on the standard compact select and labels the final option Never', () => {
        const { container } = renderAutoLock();
        const select = screen.getByRole('combobox', { name: 'Auto-lock' });

        expect(selectOptionLabels(select)).toEqual([
            '1 minute',
            '5 minutes',
            '15 minutes',
            '30 minutes',
            '1 hour',
            '4 hours',
            'Never',
        ]);
        expect(container.querySelector(`.${inlineStyles.select}`)).toContainElement(select);
    });

    it('groups a typed custom amount while saving the plain value and preserving the caret', async () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);
            return 1;
        });
        const { input, update } = renderTestSend();
        input.focus();

        typeAmount(input, '3000000');
        expect(input).toHaveValue('3,000,000');
        expect(input.selectionStart).toBe(input.value.length);
        fireEvent.blur(input);
        await waitFor(() => expect(update).toHaveBeenCalledWith({
            grace: { testSendThresholdFiat: '3000000' },
        }));

        update.mockClear();
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '39,000,000');
        input.setSelectionRange(2, 2);
        fireEvent(input, new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: '9',
        }));
        expect(input).toHaveValue('39,000,000');
        expect(input.selectionStart).toBe(2);

        fireEvent.blur(input);
        await waitFor(() => expect(update).toHaveBeenCalledWith({
            grace: { testSendThresholdFiat: '39000000' },
        }));
    });

    it('parses pasted grouping marks and stores no commas', async () => {
        const { input, update } = renderTestSend();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '3,000,000');
        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent(input, new InputEvent('input', {
            bubbles: true,
            inputType: 'insertFromPaste',
            data: '3,000,000',
        }));

        expect(input).toHaveValue('3,000,000');
        expect(normalizeTestSendAmount(input.value)).toBe('3000000');
        fireEvent.blur(input);
        await waitFor(() => expect(update).toHaveBeenCalledWith({
            grace: { testSendThresholdFiat: '3000000' },
        }));
    });
});
