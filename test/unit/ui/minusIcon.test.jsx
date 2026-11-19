// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MinusIcon } from '../../../packages/core/src/ui/icons/index.jsx';

afterEach(() => cleanup());

describe('MinusIcon', () => {
    it('renders an svg using the shared icon contract', () => {
        const { container } = render(<MinusIcon />);
        const icon = container.querySelector('svg');

        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('data-xc-icon');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
});
