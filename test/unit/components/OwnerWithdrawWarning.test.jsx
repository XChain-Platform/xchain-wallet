// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { OwnerWithdrawWarning } from '../../../packages/core/src/shared/components/OwnerWithdrawWarning.jsx';
import { OWNER_WITHDRAW_WARNING } from '../../../packages/core/src/shared/routes/contractResponseShape.js';

function renderWarning(ownerWithdraw) {
    let view;
    act(() => {
        view = render(<OwnerWithdrawWarning ownerWithdraw={ownerWithdraw} />);
    });
    return view;
}

afterEach(cleanup);

describe('OwnerWithdrawWarning', () => {
    it.each([false, null, undefined])('renders nothing for %s', (ownerWithdraw) => {
        const { container } = renderWarning(ownerWithdraw);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a truthy value other than boolean true', () => {
        const { container } = renderWarning('true');
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the deployer warning only for boolean true', () => {
        renderWarning(true);

        const warning = screen.getByTestId('owner-withdraw-warning');
        expect(warning).toHaveAttribute('role', 'note');
        expect(warning).toHaveTextContent('Deployer can withdraw');
        expect(warning).toHaveTextContent(OWNER_WITHDRAW_WARNING);
        expect(warning).toHaveTextContent('Only send tokens here if you trust the deployer.');
    });
});
