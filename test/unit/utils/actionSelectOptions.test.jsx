// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The one action-options builder behind the Advanced, Batch and Parallel
// action dropdowns: a placeholder and every action carry an icon, and an
// action reuses the Actions menu's icon for the same action.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Select } from '../../../packages/core/src/ui/Select.jsx';
import { actionSelectOptions } from '../../../packages/core/src/shared/utils/actionOptionIcon.jsx';
import { openSelectListbox } from '../../helpers/selectOption.js';

afterEach(cleanup);

describe('actionSelectOptions', () => {
    it('gives the placeholder and every action an icon, with its label text', () => {
        render(
            <Select aria-label="Action" value="" onChange={() => {}}>
                {actionSelectOptions(['SEND', 'AIRDROP', 'SDKONLY'], 'Select action')}
            </Select>,
        );
        const listbox = openSelectListbox(screen.getByRole('combobox', { name: 'Action' }));
        const rows = Array.from(listbox.querySelectorAll('[role="option"]'));
        expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['', 'SEND', 'AIRDROP', 'SDKONLY']);
        for (const row of rows) expect(row.querySelector('svg')).not.toBeNull();
        expect(rows[0].textContent).toContain('Select action');
        expect(rows[1].textContent).toContain('(SEND)');
    });
});
