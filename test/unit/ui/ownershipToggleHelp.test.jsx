// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

// The Give/Get ownership switch keeps its fixed explanation in the ? help tip;
// nothing static is drawn under the label, whether the switch is on or off.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { OwnershipToggle } from '../../../packages/core/src/shared/components/giveGet/OwnershipToggle.jsx';

afterEach(cleanup);

describe('OwnershipToggle help', () => {
    it.each([true, false])('carries the explanation in the tip and draws no line under the label (checked=%s)', (checked) => {
        const { container } = render(
            <OwnershipToggle
                label="Give this token's ownership"
                help="Moves the whole token as one piece."
                checked={checked}
                onChange={vi.fn()}
            />,
        );

        // The label is the only visible line; the tip text is not drawn in the row.
        expect(container.querySelector('label')).toHaveTextContent("Give this token's ownership");
        expect(container.querySelectorAll('span[id$="-hint"]')).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: "About Give this token's ownership" }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Moves the whole token as one piece.');
        expect(screen.getByRole('switch')).not.toHaveAttribute('aria-describedby');
    });
});
