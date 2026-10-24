// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { VerifySignatureForm } from '../../../packages/core/src/shared/routes/VerifySignatureForm.jsx';

afterEach(cleanup);

describe('signature verification text direction', () => {
    it('keeps the address and signature left to right and lets the message pick its own direction', async () => {
        const messaging = new Proxy({ verifyMessageRequest: vi.fn() }, {
            get(value, prop) { return prop in value ? value[prop] : vi.fn().mockResolvedValue({}); },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <VerifySignatureForm onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /Network: Bitcoin/ });

        // Base64 ends in "=" and contains "+" and "/", which a right to left
        // paragraph reorders; an address read backwards is a different string.
        expect(screen.getByLabelText('Address')).toHaveAttribute('dir', 'ltr');
        expect(screen.getByLabelText('Signature')).toHaveAttribute('dir', 'ltr');
        expect(screen.getByLabelText('Message')).toHaveAttribute('dir', 'auto');
    });
});
