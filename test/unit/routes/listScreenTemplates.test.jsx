// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import betFeedsSource from '../../../packages/core/src/shared/routes/BetFeedsList.jsx?raw';
import coSignerPolicySource from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx?raw';
import multisigShareSource from '../../../packages/core/src/shared/routes/MultisigCosignerShare.jsx?raw';
import receivePickerSource from '../../../packages/core/src/shared/routes/ReceivePicker.jsx?raw';
import sendPickerSource from '../../../packages/core/src/shared/routes/SendPicker.jsx?raw';
import signerSelectSource from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx?raw';
import stakeNewSource from '../../../packages/core/src/shared/routes/StakeNew.jsx?raw';

describe('list screen templates', () => {
    it('builds the new-stake chooser on ListPage', () => {
        expect(stakeNewSource).toMatch(/<ListPage\b/);
    });

    it('uses the shared list row for stake choices and the shared market card for betting choices', () => {
        expect(stakeNewSource).toMatch(/<ListRow\b/);
        expect(betFeedsSource).toMatch(/<BetMarketCard\b/);
        expect(betFeedsSource).toMatch(/<ListPage\b/);
        expect(betFeedsSource).not.toMatch(/className=\{rowStyles\.entry\}/);
        expect(betFeedsSource).not.toMatch(/className=\{styles\.card\}/);
        expect(stakeNewSource).not.toMatch(/wrapFull|wrapPopup/);
    });

    it('gives shared pickers and form fragments their matching page templates', () => {
        expect(receivePickerSource).toMatch(/<ListPage\b/);
        expect(sendPickerSource).toMatch(/<ListPage\b/);

        expect(multisigShareSource).toMatch(/<FormPage\b/);
        expect(multisigShareSource).toMatch(/<FormSection\b/);
        // The signer choice is a fragment inside its parent's form: one
        // RadioGroup with the intro as its help tip, no page of its own.
        expect(signerSelectSource).not.toMatch(/<FormPage\b/);
        expect(signerSelectSource).toMatch(/<RadioGroup\b/);
        // The co-signer policy editor is a fragment inside its parent's form:
        // its collapsible sections join the parent FormPage's flow instead of
        // opening a page of their own.
        expect(coSignerPolicySource).not.toMatch(/<FormPage\b/);
        expect(coSignerPolicySource).toMatch(/style=\{\{ display: 'contents' \}\}/);
        expect(coSignerPolicySource).toMatch(/<PolicySection\b/);
    });
});
