// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Load-failure copy on the agent-account detail screen.
//
// `getCoSignerAccount` throws its own precondition errors prefixed with
// the function name ("getCoSignerAccount: id is required"), and those
// cross the shell messaging boundary intact: MessageHost's
// hydrateEnvelopeError rebuilds the Error from {name, message} without
// touching the text. So a screen doing `setError(err.message)` paints a
// developer string, which is what this screen used to do.
//
// The three cases below are the whole contract of the filter, asserted
// against the rendered DOM rather than against the helper in isolation,
// because the helper already had unit coverage while the wiring did not.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';

function mountRejecting(err) {
    const messaging = {
        getSettings: () => Promise.resolve({}),
        getCoSignerAccount: () => Promise.reject(err),
    };
    return render(
        <MessagingProvider shell="extension" messaging={messaging}>
            <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('CoSignerAccountDetail load-error copy', () => {
    it('shows house copy when the flow throws its function-prefixed precondition error', async () => {
        mountRejecting(new Error('getCoSignerAccount: id is required'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load the agent account.')).toBeTruthy();
        });
    });

    it('never paints the raw developer string', async () => {
        mountRejecting(new Error('getCoSignerAccount: vault is required'));
        await waitFor(() => {
            expect(screen.getByText('Failed to load the agent account.')).toBeTruthy();
        });
        // The filter is only worth having if the developer text is gone,
        // not merely accompanied by the fallback.
        expect(screen.queryByText(/getCoSignerAccount:/)).toBeNull();
    });

    it('passes a genuinely user-facing backend message straight through', async () => {
        // The filter must not become a translator: copy already written for
        // a person keeps its wording, or every backend explanation collapses
        // into the same generic sentence.
        mountRejecting(new Error('This agent account was revoked on another device.'));
        await waitFor(() => {
            expect(screen.getByText('This agent account was revoked on another device.')).toBeTruthy();
        });
    });
});
