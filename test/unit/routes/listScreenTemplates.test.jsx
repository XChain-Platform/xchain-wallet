// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import betFeedsSource from '../../../packages/core/src/shared/routes/BetFeedsList.jsx?raw';
import coSignerPolicySource from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx?raw';
import menuSource from '../../../packages/core/src/shared/routes/MenuRoute.jsx?raw';
import multisigShareSource from '../../../packages/core/src/shared/routes/MultisigCosignerShare.jsx?raw';
import receivePickerSource from '../../../packages/core/src/shared/routes/ReceivePicker.jsx?raw';
import sendPickerSource from '../../../packages/core/src/shared/routes/SendPicker.jsx?raw';
import signerSelectSource from '../../../packages/core/src/shared/routes/SignerSelectForm.jsx?raw';
import stakeNewSource from '../../../packages/core/src/shared/routes/StakeNew.jsx?raw';

describe('list screen templates', () => {
    it('builds the menu and new-stake chooser on ListPage', () => {
        expect(menuSource).toMatch(/<ListPage\b/);
        expect(stakeNewSource).toMatch(/<ListPage\b/);
    });

    it('uses the shared list row for menu, stake, and betting choices', () => {
        expect(menuSource).toMatch(/className=\{rowStyles\.entry\}/);
        expect(stakeNewSource).toMatch(/className=\{styles\.entry\}/);
        expect(betFeedsSource).toMatch(/className=\{rowStyles\.entry\}/);
        expect(betFeedsSource).not.toMatch(/className=\{styles\.card\}/);
        expect(stakeNewSource).not.toMatch(/wrapFull|wrapPopup/);
    });

    it('gives shared pickers and form fragments their matching page templates', () => {
        expect(receivePickerSource).toMatch(/<ListPage\b/);
        expect(sendPickerSource).toMatch(/<ListPage\b/);

        for (const source of [coSignerPolicySource, multisigShareSource, signerSelectSource]) {
            expect(source).toMatch(/<FormPage\b/);
            expect(source).toMatch(/<FormSection\b/);
        }
    });
});
