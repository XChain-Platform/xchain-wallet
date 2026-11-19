// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The policy editor shows the token number each named token was saved with,
// and marks the field of a ticker the save could not match to a number.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    emptyPolicyDraft,
    CoSignerPolicyEditor,
} from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';

afterEach(() => cleanup());

function listDraft(text) {
    return { ...emptyPolicyDraft(), allowedActionsText: 'SEND', tokenMode: 'list', allowedTicksText: text };
}

describe('CoSignerPolicyEditor token numbers', () => {
    it('shows the number each token was saved with', () => {
        render(<CoSignerPolicyEditor value={listDraft('MYTOKEN, XCHAIN')} onChange={() => {}} tokenIds={{ MYTOKEN: 1234, XCHAIN: 1 }} />);
        expect(screen.getByTestId('policy-token-numbers').textContent)
            .toBe('Token numbers saved with these rules: MYTOKEN number 1234, XCHAIN number 1');
    });

    it('shows no number line for rules saved before numbers were recorded', () => {
        render(<CoSignerPolicyEditor value={listDraft('MYTOKEN')} onChange={() => {}} />);
        expect(screen.queryByTestId('policy-token-numbers')).toBeNull();
    });

    it('marks the token field of a ticker the save could not match', () => {
        const message = "NOPE wasn't found on this network. Check the ticker or remove it, then save again.";
        render(<CoSignerPolicyEditor value={listDraft('MYTOKEN, NOPE')} onChange={() => {}} tokenErrors={{ NOPE: message }} />);
        expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain(message);
    });
});
