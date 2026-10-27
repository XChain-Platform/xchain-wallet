// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';

function draw() {
    return render(
        <MessagingProvider shell="popup" messaging={{}}>
            <CreateWallet onBack={() => {}} onCreated={() => {}} />
        </MessagingProvider>,
    );
}

function submitWithName(name) {
    draw();
    fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

afterEach(cleanup);

describe('CreateWallet wallet name', () => {
    it('refuses a name that draws no mark', () => {
        submitWithName('​​​');

        expect(screen.getByRole('alert')).toHaveTextContent('Wallet name must include a visible character.');
        expect(screen.queryByRole('button', { name: 'Reveal recovery phrase' })).toBeNull();
    });

    it('refuses a name past the shared length cap', () => {
        submitWithName('N'.repeat(65));

        expect(screen.getByRole('alert')).toHaveTextContent('Wallet name must be 64 characters or fewer.');
        expect(screen.queryByRole('button', { name: 'Reveal recovery phrase' })).toBeNull();
    });

    it('accepts a name of exactly the cap and a blank name that takes the default', () => {
        submitWithName('N'.repeat(64));
        expect(screen.getByRole('button', { name: 'Reveal recovery phrase' })).toBeTruthy();
        cleanup();

        submitWithName('   ');
        expect(screen.getByRole('button', { name: 'Reveal recovery phrase' })).toBeTruthy();
    });
});
