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
        'StakeNew.module.css',
        'TokenWizard.module.css',
        'CrossChainTemplates.module.css',
    ])('%s groups repeated rows in one flush card', (name) => {
        expect(route(name)).toMatch(/composes:\s*flush from ['"]\.\.\/\.\.\/ui\/Card\.module\.css['"]/);
    });

    it('keeps repeated form groups borderless', () => {
        expect(route('LinkForm.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('MultisigCreate.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('CoSignerPolicyEditor.jsx')).not.toMatch(/cardStyles\.card/);
        expect(route('CoSignerPolicyEditor.module.css')).toMatch(/\.fieldset\s*\{[^}]*border:\s*0/s);
        expect(route('IssueTokenForm.module.css')).toMatch(/\.flatFieldset\s*\{[^}]*border:\s*0/s);
    });

    it('uses one outer surface for composite detail screens', () => {
        expect(route('ManageToken.jsx')).toMatch(/className=\{styles\.approvedDetailsCard\}/);
        expect(route('ManageToken.module.css')).toMatch(/\.approvedDetailsCard\s*\{[^}]*composes:\s*card/s);
        expect(route('Settings.jsx')).toMatch(/className=\{settingsStyles\.settingsList\}/);
        expect(route('Settings.module.css')).toMatch(/\.settingsList\s*\{[^}]*composes:\s*flush/s);
        expect(route('AddressList.module.css')).toMatch(/\.tabPanel\s*\{[^}]*composes:\s*card/s);
    });

    it('does not draw a capability card inside the stake form', () => {
        expect(route('StakeForm.jsx')).not.toMatch(/border:\s*['"]var\(--xc-card-border\)['"]/);
        expect(route('StakeForm.jsx')).not.toMatch(/background:\s*['"]var\(--xc-card-bg\)['"]/);
    });

    it('preserves already-flat form sections and empty states', () => {
        expect(route('SweepForm.jsx')).toMatch(/<FormPage[\s\S]*sectioned[\s\S]*<FormSection title="What to sweep">/);
        expect(route('ParallelComposer.jsx')).toMatch(/function RowEditor[\s\S]*<FormSection[\s\S]*title=\{`Row \$\{index \+ 1\}`\}/);
        expect(route('UnionListForm.jsx')).toMatch(/className=\{styles\.flatFieldset\}[\s\S]*<EmptyState/);
    });
});
