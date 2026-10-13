// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ purpose, hideOwnFilter, marker }) => (
        <output
            data-testid="token-picker-props"
            data-purpose={purpose}
            data-hide-own-filter={String(hideOwnFilter)}
            data-marker={marker}
        />
    ),
}));

import { ReceivePicker } from '../../../packages/core/src/shared/routes/ReceivePicker.jsx';
import { SendPicker } from '../../../packages/core/src/shared/routes/SendPicker.jsx';

afterAll(() => {
    vi.doUnmock('../../../packages/core/src/shared/routes/TokenPicker.jsx');
});

describe('Send and Receive picker wrappers', () => {
    it.each([
        ['SendPicker', SendPicker, 'receive', 'send'],
        ['ReceivePicker', ReceivePicker, 'send', 'receive'],
    ])('%s fixes its purpose while forwarding supported props', (_name, Picker, attemptedPurpose, expectedPurpose) => {
        render(<Picker purpose={attemptedPurpose} hideOwnFilter marker="forwarded" />);

        const output = screen.getByTestId('token-picker-props');
        expect(output).toHaveAttribute('data-purpose', expectedPurpose);
        expect(output).toHaveAttribute('data-marker', 'forwarded');
        expect(output).toHaveAttribute('data-hide-own-filter', 'undefined');
    });
});
