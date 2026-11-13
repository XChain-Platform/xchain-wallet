// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Onboarding and shell layout rulings, pinned at the source level: the
// recovery phrase card and its spacing, the header Back on every setup step,
// the pair-role button descriptions, the Locked field-to-button gap and the
// wallet menu row height. Only a browser can confirm how these look; these
// checks hold the CSS and markup that produce the look.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const routes = 'packages/core/src/shared/routes/';

/** Body of the first rule whose selector list is exactly `selector`. */
function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
}

describe('recovery phrase card and spacing', () => {
    const grid = read('packages/core/src/shared/components/MnemonicGrid.jsx');
    const gridCss = read('packages/core/src/shared/components/MnemonicGrid.module.css');
    const create = read(`${routes}CreateWallet.jsx`);
    const createCss = read(`${routes}CreateWallet.module.css`);

    it('draws the word box in both states with the reveal button centred inside it', () => {
        // One card wraps the concealed and the revealed state, so the box never disappears.
        expect(grid).toMatch(/<div className=\{styles\.card\} data-mnemonic-card="">[\s\S]*revealed \? \([\s\S]*concealedGrid[\s\S]*revealAction/);
        expect(rule(gridCss, '.card')).toMatch(/composes: card from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        const reveal = rule(gridCss, '.revealAction');
        expect(reveal).toMatch(/position: absolute/);
        expect(reveal).toMatch(/inset: 0/);
        expect(reveal).toMatch(/align-items: center/);
        expect(reveal).toMatch(/justify-content: center/);
    });

    it('keeps the card on wide screens because the phrase step is a cardless form', () => {
        expect(create).toMatch(/label=\{t\('importWallet\.recoveryPhrase'\)\}\s*cardless/);
        const cardCss = read('packages/core/src/ui/Card.module.css');
        // Wide forms flatten padded cards only inside a form that is not cardless.
        expect(cardCss).toMatch(/\.formCard:not\(\.cardless\) \.card\s*\{/);
        const formPage = read('packages/core/src/ui/FormPage.jsx');
        expect(formPage).toMatch(/cardless \? styles\.cardlessForm : null/);
        expect(formPage).toMatch(/fullWidth \|\| cardless \? styles\.cardlessSections/);
        expect(read('packages/core/src/ui/FormPage.module.css')).toMatch(/\.cardlessSections\s*\{\s*composes:\s*cardless from '\.\/Card\.module\.css'/);
    });

    it('puts the copy note directly under the box and Verify directly under the checkbox', () => {
        expect(create).toMatch(/<div className=\{styles\.phraseStack\}>\s*<MnemonicGrid[^>]*\/>\s*<p className=\{styles\.copyHint\}>/);
        expect(create).toMatch(/<div className=\{styles\.confirmActions\}>\s*<Checkbox[\s\S]*?\/>\s*<Button\s+variant="success"\s+onClick=\{handleStartVerify\}/);
        // One shared rule lays the three stacks out; the gap is the one token step.
        expect(createCss).toMatch(/\.phraseStack,\s*\.confirmActions,\s*\.quizActions\s*\{[^}]*gap: var\(--xc-space-2\);[^}]*\}/);
        // Neither stack adds a margin of its own on top of that gap.
        expect(rule(createCss, '.copyHint')).toMatch(/margin: 0/);
        expect(rule(createCss, '.confirmRow')).toMatch(/margin: 0/);
    });
});

describe('header Back on every setup step', () => {
    const steps = ['CreateWallet.jsx', 'ImportWallet.jsx', 'PairPartnerWallet.jsx', 'MigrateToBip39.jsx'];

    it.each(steps)('%s gives its header the back chevron and keeps no Back button in the page', (file) => {
        const source = read(`${routes}${file}`);
        expect(source).toMatch(/<PageHeader[\s\S]*?onBack=/);
        expect(source).not.toMatch(/Icon\.BackIcon/);
        expect(source).not.toMatch(/<Button[^>]*>\s*\{?t?\(?['"]?Back['"]?\)?\}?\s*<\/Button>/);
    });

    it('gives the create flow a header on every stage, including verify', () => {
        const create = read(`${routes}CreateWallet.jsx`);
        // The header is one element shared by the password, phrase, verify and notice stages.
        expect(create.match(/header=\{screenHeader\}/g).length).toBeGreaterThanOrEqual(5);
        expect(create).toMatch(/if \(stage === 'verify'\) \{[\s\S]*?<Screen variant=\{variant\} header=\{screenHeader\}>/);
    });

    it('allows one in-page back-style action: the demo gate choice to keep exploring', () => {
        // Not a Back button: it is a labelled choice that leaves the demo gate.
        const onboarding = read(`${routes}Onboarding.jsx`);
        expect(onboarding.match(/Icon\.BackIcon/g)).toHaveLength(1);
        expect(onboarding).toMatch(/Icon\.BackIcon[\s\S]{0,200}onboarding\.keepExploringTheDemo/);
    });
});

describe('pair role choices', () => {
    const pair = read(`${routes}PairPartnerWallet.jsx`);
    const pairCss = read(`${routes}PairPartnerWallet.module.css`);

    it('opens with an overview and a step indicator', () => {
        expect(pair).toMatch(/if \(stage === 'role'\) \{[\s\S]*?<StepIndicator[\s\S]*?className=\{styles\.overview\}/);
    });

    it('sets each description directly under its own button', () => {
        const blocks = pair.match(/<div className=\{styles\.roleChoice\}>\s*<Button[\s\S]*?<\/Button>\s*<p className=\{styles\.fullWidthText\}>[^<]+<\/p>\s*<\/div>/g);
        expect(blocks).toHaveLength(2);
    });

    it('spaces the pairs wider than the button-to-text gap', () => {
        expect(rule(pairCss, '.roleChoices')).toMatch(/gap: var\(--xc-space-5\)/);
        expect(rule(pairCss, '.roleChoice')).toMatch(/gap: var\(--xc-space-1\)/);
    });
});

describe('Locked screen field-to-button gap', () => {
    const css = read(`${routes}Locked.module.css`);
    const locked = read(`${routes}Locked.jsx`);

    it('adds no space of its own between the password field and Unlock', () => {
        expect(rule(css, '.passwordField')).not.toMatch(/margin|padding/);
        expect(rule(css, '.unlockActions')).not.toMatch(/margin|padding/);
        // The only gap is the shared form gap, one token step.
        expect(read('packages/core/src/ui/tokens.css')).toMatch(/--xc-form-gap: var\(--xc-space-4\)/);
        expect(read('packages/core/src/ui/FormPage.module.css')).toMatch(/\.body\s*\{[^}]*gap: var\(--xc-form-gap\)/);
    });

    it('keeps the idle error line below the actions, not between field and button', () => {
        expect(rule(css, '.centreIdle::after')).toMatch(/block-size: calc\(var\(--xc-help-gap\) \+ var\(--xc-text-xs\) \* 1\.4\)/);
        expect(locked).toMatch(/The wrong-password message appears under the field/);
    });
});

describe('wallet menu row height', () => {
    const css = read('packages/core/src/shared/commandPalette/CommandPalette.module.css');

    it('sizes Settings and Lock with the same rule as every group row', () => {
        // One selector list carries the shared row look; the footer adds only width.
        expect(css).toMatch(/\.walletGroupList \.walletRow,\s*\.walletFooter \.walletFooterRow\s*\{[^}]*white-space: nowrap/);
        const footerOnly = rule(css, '.walletFooter .walletFooterRow');
        expect(footerOnly).toMatch(/inline-size: 100%/);
        expect(footerOnly).not.toMatch(/block-size|height|padding-block|margin-block|line-height/);
    });

    it('applies the compact row height to both lists through one variable', () => {
        expect(css).toMatch(/\.walletGroupList \.walletRow,\s*\.walletFooter \.walletFooterRow\s*\{\s*--xc-button-height: var\(--xc-wallet-menu-row-h\);\s*min-block-size: var\(--xc-wallet-menu-row-h\);\s*block-size: var\(--xc-wallet-menu-row-h\);/);
    });

    it('draws the Settings label on one line', () => {
        const menu = read('packages/core/src/shared/walletMenu.js');
        expect(menu).toMatch(/id: 'settings', labelKey: 'walletMenu\.row\.settings'/);
        expect(css).toMatch(/white-space: nowrap/);
    });
});
