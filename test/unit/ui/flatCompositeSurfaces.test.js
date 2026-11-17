// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const route = (name) => read(`packages/core/src/shared/routes/${name}`);

describe('flat composite surfaces', () => {
    it.each([
        'MyTokens.module.css',
        'MarketActivity.module.css',
        'PairSignerForm.module.css',
    ])('%s groups repeated rows in one flush card', (name) => {
        expect(route(name)).toMatch(/composes:\s*flush from ['"]\.\.\/\.\.\/ui\/Card\.module\.css['"]/);
    });

    it('keeps repeated form groups borderless', () => {
        expect(route('LinkForm.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('MultisigCreate.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('CoSignerPolicyEditor.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('IssueTokenForm.module.css')).toMatch(/\.flatFieldset\s*\{[^}]*border:\s*0/s);
    });

    it('uses one outer surface for composite detail screens', () => {
        // The asset page (coins and tokens, My Tokens included) draws its
        // Details in one card; ManageToken.module.css keeps the card the
        // co-signer and address pages reuse.
        expect(route('TokenDetail.jsx')).toMatch(/className=\{styles\.detailsCard\}/);
        expect(route('TokenDetail.module.css')).toMatch(/\.detailsCard\s*\{[^}]*composes:\s*card/s);
        expect(route('ManageToken.module.css')).toMatch(/\.approvedDetailsCard\s*\{[^}]*composes:\s*card/s);
        expect(route('Settings.jsx')).toMatch(/className=\{settingsStyles\.settingsList\}/);
        expect(route('Settings.module.css')).toMatch(/\.settingsList\s*\{[^}]*composes:\s*flush/s);
        // View Address (AddressDetail, split out of AddressList) reuses the
        // token page's detail cards; its panel is the shared Actions | Details
        // toggle's plain column (G102), so no card sits inside another card (U16).
        expect(route('AddressDetail.jsx')).toMatch(/className=\{tokenPageStyles\.approvedDetailsCard\}/);
        expect(route('AddressDetail.jsx')).toMatch(/<ActionsDetailsToggle\b/);
        expect(route('AddressDetail.module.css')).not.toMatch(/\.panel\s*\{/);
        expect(route('AddressList.module.css')).not.toMatch(/\.tabPanel\s*\{/);
    });

    it('does not draw a capability card inside the stake form', () => {
        expect(route('StakingForm.jsx')).not.toMatch(/border:\s*['"]var\(--xc-card-border\)['"]/);
        expect(route('StakingForm.jsx')).not.toMatch(/background:\s*['"]var\(--xc-card-bg\)['"]/);
    });

    it('preserves already-flat form sections and empty states', () => {
        expect(route('SweepForm.jsx')).toMatch(/<FormFrame[\s\S]*<FormSection\s+id="sweep"\s+title="Sweep Details"/);
        expect(route('ParallelComposer.jsx')).toMatch(/function RowEditor[\s\S]*<FormSection[\s\S]*title=\{`Row \$\{index \+ 1\}`\}/);
        expect(route('ListCreateForm.jsx')).toMatch(/className=\{styles\.flatFieldset\}[\s\S]*<EmptyState/);
    });
});
