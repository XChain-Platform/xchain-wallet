// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SignerSelectForm } from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx';

afterEach(cleanup);

describe('SignerSelectForm optional callback safety', () => {
    it('settles an empty signer list when no change callback is provided', async () => {
        const listSigners = vi.fn().mockResolvedValue([]);

        render(
            <MessagingProvider shell="web" messaging={{ listSigners }}>
                <SignerSelectForm walletId="wallet-1" value="stale-signer" />
            </MessagingProvider>,
        );

        await waitFor(() => expect(listSigners).toHaveBeenCalledWith('wallet-1'));
    });
});
