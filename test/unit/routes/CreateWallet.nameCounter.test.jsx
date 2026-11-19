// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet name on the create-wallet password step shows its length
// counter on the label line (U56), and its label carries the help tip (U57).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { NAME_MAX_LENGTH } from '../../../packages/core/src/util/display_name.js';

afterEach(cleanup);

describe('CreateWallet wallet name counter', () => {
    it('limits the name to the shared cap and counts as the user types', () => {
        render(
            <MessagingProvider shell="popup" messaging={{}}>
                <CreateWallet onBack={() => {}} onCreated={() => {}} />
            </MessagingProvider>,
        );
        const name = screen.getByLabelText('Wallet name', { selector: 'input' });
        expect(name).toHaveAttribute('maxLength', String(NAME_MAX_LENGTH));
        fireEvent.change(name, { target: { value: 'Savings' } });
        expect(screen.getByText(`7 / ${NAME_MAX_LENGTH}`)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Wallet name' })).toBeTruthy();
    });
});
