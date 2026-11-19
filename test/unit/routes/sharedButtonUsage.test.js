// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ActionsMenu left this list for actionListRoutes below: its entries are the
// shared ActionList rows (G101), not Button cards.
const migratedRoutes = [
    'AirdropForm',
    'AlertsRoute',
    'BetFeedsList',
    'ContactsList',
    'ContractDetail',
    'ContractsList',
    'CreateOrderForm',
    'CreateWallet',
    'DeployContractForm',
    'DispenserExplorer',
    'DispenserForm',
    'DispensersList',
    'ListCreateForm',
    'MessagingInbox',
    'ParallelComposer',
    'PublishFileForm',
    'BatchComposerForm',
    'SwapForm',
];

const styleGuideRoutes = {
    AccountPicker: ['Button', 'ListRow'],
    CoSignerPolicyEditor: ['Button', 'Checkbox', 'Input', 'Select', 'Switch'],
    ControllerBindForm: ['Button', 'Checkbox', 'Input', 'Select'],
    // The one List form picks its action and list type in the themed
    // IconSelect; its Fork and Edit body's members are Checkboxes and its
    // memo the shared MemoSection; Transfer's new owner is an AddressField.
    ListCreateForm: ['AddressField', 'Button', 'Checkbox', 'IconSelect', 'Input', 'MemoSection', 'Textarea'],
    MarketActivity: ['Button'],
    MarketView: ['Button'],
    MultisigCreate: ['Button', 'Input', 'Select'],
    PairSignerForm: ['Button', 'Input'],
    PollDetail: ['Button', 'Checkbox', 'Input'],
    // Send's coin-control Checkboxes moved to the shared Advanced section
    // (formStandard/AdvancedSection.jsx), which every fee-paying form shows.
    // Its per-recipient token Switch left with the old extra-recipient rows:
    // the Payment section's Single, Multi and Advanced choice is the kit Tabs.
    Send: ['Button', 'Tabs'],
};
// A single choice is the themed IconSelect, never radios (G119).
const choiceControlRoutes = {
    History: ['Checkbox', 'IconSelect'],
    Send: ['Tabs'],
};
const styleGuideRowRoutes = [
    'BetFeedDetail',
    'CoSignerAccountList',
    'CoinpayForm',
    'ComposeMessage',
    'DeployContractForm',
    'DispenserExplorer',
    'DispensersList',
    'GovernancePolls',
];

const listRowRoutes = [
    'ContactsList',
    'CoSignerAccountList',
    'MarketActivity',
    'MyLists',
];

const choicePrimitiveRoutes = {
    // Attach Artwork has no choice control now that the token-picture toggle is gone.
    // The publish forms carry no acknowledgement checkbox; permanence is a
    // confirm-screen notice. Their single choices (Publish as, Pack) are the
    // themed IconSelect, never radios (G119).
    GatedPublishForm: ['IconSelect'],
    PublishFileForm: ['IconSelect'],
    SleepForm: ['IconSelect'],
};
const tokenControlRoutes = [
    ['IssueTokenForm', { Switch: 2 }],
    // Lock token's flags are Issue-style lock switches; the bridge freeze
    // option is a plain toggle field with its static warning under it (G120
    // placement, operator 2026-11-15 on Bridge settings, revising G118 here).
    ['TokenAdminForm', { Switch: 2 }],
    // The sweep's category list is an OptionSwitchList of OptionSwitch rows
    // (ruling G118); its acknowledgement moved to the confirm screen.
    ['SweepForm', { OptionSwitchList: 1, OptionSwitch: 1 }],
    // The one Staking form: its action control is the shared toggle on a
    // contract and an IconSelect on the network (five segments do not fit);
    // the second IconSelect is a validator stake's Mode (New stake or Top up).
    ['StakingForm', { SegmentedControl: 1, IconSelect: 2 }],
];

describe('shared route button usage', () => {
    it.each([
        // MarketsList left this list: its Show choice (Popular, All, Watchlist)
        // is a Select in the title-line filter menu, not a tab strip. TokenPicker
        // left it too: its asset kind is an IconSelect in the same filter.
        'ImportWallet',
        'TokenDetail',
    ])('%s uses the shared Tabs component', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bTabs\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<Tabs\b/);
    });

    it.each([
        'AccountDetails',
        'ActionsMenu',
        'AddressDetail',
        'Home',
        'WalletDetails',
    ])('%s draws its actions as the shared ActionList (G101)', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{\s*ActionList,\s*ActionListItem\s*\}\s+from\s+'\.\.\/components\/ActionList\.jsx'/);
        expect(source).toMatch(/<ActionList\b/);
        expect(source).not.toMatch(/QuickActionTile|data-xc-menu-list/);
    });

    it.each(migratedRoutes)('%s uses the shared Button component', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bButton\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<Button\b/);
        expect(source).not.toMatch(/<button\b/);
    });

    it.each([
        'AirdropForm',
        'BatchComposerForm',
        'MessagingInbox',
        'ParallelComposer',
        'PublishFileForm',
    ])('%s uses kit controls instead of native buttons, selects, and textareas', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).not.toMatch(/<(?:button|select|textarea)\b/);
    });

    it('uses shared choice controls on Publish file', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/PublishFileForm.jsx'),
            'utf8',
        );

        // Publish as is the themed dropdown, never radios (G119).
        expect(source).toMatch(/import\s+\{[^}]*\bIconSelect\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<IconSelect\b/);
        expect(source).not.toMatch(/<RadioGroup\b/);
        // No acknowledgement checkbox, and the file input is the shared field.
        expect(source).not.toMatch(/<Checkbox\b/);
        expect(source).toMatch(/<FileField\b/);
        expect(source).not.toMatch(/<input\b/);
    });

    it.each(Object.entries(styleGuideRoutes))('%s uses kit form and action controls', (routeName, controls) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        for (const control of controls) {
            expect(source).toMatch(new RegExp(`<${control}\\b`));
        }
        expect(source).not.toMatch(/<(?:select|textarea)\b/);
    });

    it.each(Object.entries(choiceControlRoutes))('%s uses kit choice controls', (routeName, controls) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        for (const control of controls) {
            expect(source).toMatch(new RegExp(`<${control}\\b`));
        }
        expect(source).not.toMatch(/<input\b[^>]*type="(?:checkbox|radio)"/s);
        expect(source).not.toMatch(/The kit has no (?:checkbox|radio|switch)/);
    });

    it.each([
        ['SellOwnershipForm', ['Button', 'Input'], 0],
        // The settings search sits in the header filter menu, not an inline Input.
        ['Settings', ['Button', 'ListFilterMenu'], 1],
        // The From section holds the address picker and the FormAction is the
        // one submit, so the form draws neither a raw AddressField nor a Button.
        ['SignMessageForm', ['FromSection', 'FormAction', 'CopyButton', 'Input', 'Textarea'], 0],
        // Search, network and kind sit in the shared title-line filter.
        ['TokenPicker', ['ListFilterMenu', 'IconSelect'], 0],
        ['VerifySignatureForm', ['FormAction', 'Input', 'Textarea'], 0],
        ['WalletPicker', ['Button', 'ListRow'], 0],
    ])('%s adopts kit controls and documents any native list row', (routeName, primitives, nativeRowCount) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        for (const primitive of primitives) {
            expect(source).toMatch(new RegExp(`<${primitive}\\b`));
        }
        expect(source).not.toMatch(/<(?:input|select|textarea)\b/);
        expect(source.match(/<button\b/g) || []).toHaveLength(nativeRowCount);
        if (nativeRowCount > 0) {
            expect(source).toMatch(/Keep the native button because the complete .+ row is the list .+ target\./);
        }
    });

    it.each(styleGuideRowRoutes)('%s uses kit controls instead of native form controls', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).not.toMatch(/<(?:input|select|textarea)\b/);
        const nativeButtons = source.match(/<button\b/g) || [];
        expect(nativeButtons).toHaveLength(0);
    });

    it.each(listRowRoutes)('%s uses the shared ListRow for interactive rows', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bListRow\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<ListRow\b/);
        expect(source).not.toMatch(/<button\b/);
    });

    it('GovernancePolls uses the approved prediction-market question card', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/GovernancePolls.jsx'),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bQuestionCard\b[^}]*\}\s+from\s+'\.\.\/components\/BetMarketCard\.jsx'/s);
        expect(source).toMatch(/<QuestionCard\b/);
        expect(source).not.toMatch(/<ListRow\b/);
    });

    it.each(tokenControlRoutes)('%s uses the matching kit choice controls', (routeName, controls) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        for (const [control, count] of Object.entries(controls)) {
            expect(source).toMatch(
                new RegExp(`import\\s+\\{[^}]*\\b${control}\\b[^}]*\\}\\s+from\\s+'@xchain-wallet/core/ui'`, 's'),
            );
            expect(source.match(new RegExp(`<${control}\\b`, 'g')) || []).toHaveLength(count);
        }
        expect(source).not.toMatch(/<input\b/);
    });

    it('limits native controls in the adopted routes to documented semantic exceptions', () => {
        const expectedInputs = {};

        for (const routeName of Object.keys(styleGuideRoutes)) {
            const source = readFileSync(
                resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
                'utf8',
            );
            const nativeInputs = source.match(/<input\b/g) || [];
            const inputRationales = source.match(/The kit has no (?:checkbox|radio) primitive/g) || [];
            const nativeButtons = source.match(/<button\b/g) || [];
            const rowRationales = source.match(/Clickable list rows stay native buttons/g) || [];

            expect(nativeInputs, routeName).toHaveLength(expectedInputs[routeName] || 0);
            expect(inputRationales, routeName).toHaveLength(nativeInputs.length);
            expect(nativeButtons, routeName).toHaveLength(0);
            expect(rowRationales, routeName).toHaveLength(nativeButtons.length);
        }
    });

    it.each(['ContactsPickerScreen', 'ListPickerScreen'])('%s uses ListRow for selectable rows', (componentName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/components/${componentName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bListRow\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<ListRow\b/);
        expect(source).not.toMatch(/<button\b/);
    });

    it.each(Object.entries(choicePrimitiveRoutes))(
        '%s uses kit choice controls instead of native checkbox or radio markup',
        (routeName, controls) => {
            const source = readFileSync(
                resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
                'utf8',
            );

            for (const control of controls) {
                expect(source).toMatch(new RegExp(`\\b${control}\\b`));
                expect(source).toMatch(new RegExp(`<${control}\\b`));
            }
            expect(source).not.toMatch(/type="(?:checkbox|radio)"/);
            expect(source).not.toMatch(/kit has no (?:checkbox|radio|radio-group) control/);
        },
    );

    it('uses kit controls for settings switches and wallet mode choices', () => {
        const primitives = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/settings/_settingsPrimitives.jsx',
        ), 'utf8');
        const walletMode = readFileSync(resolve(
            process.cwd(),
            // §20: the per-wallet mode field that replaced the Settings section.
            'packages/core/src/shared/components/WalletModeField.jsx',
        ), 'utf8');

        expect(primitives).toMatch(/import\s+\{[^}]*\bSwitch\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        // Settings messages are the shared inline message row.
        expect(primitives).toMatch(/import\s+\{[^}]*\bStatusMessage\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        expect(primitives).toMatch(/<StatusMessage\b/);
        expect(primitives).not.toMatch(/1px dashed/);
        expect(primitives).toMatch(/<Switch\b/);
        expect(primitives).not.toMatch(/<input\b/);
        // Wallet mode is the standard themed dropdown (G44, G96), not radios.
        expect(walletMode).toMatch(/import\s+\{[^}]*\bSelect\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        expect(walletMode).toMatch(/<Select\b/);
        expect(walletMode).not.toMatch(/<RadioGroup\b/);
        expect(walletMode).not.toMatch(/<input\b/);
    });
});

describe('trade form style guide primitives', () => {
    const tradeChoicePrimitiveRoutes = {
        // The acknowledgement checkboxes left these forms with the confirm summary.
        // Expiration is the shared ExpirationFields (its Select lives in
        // expirationChoice.jsx); auto-pay is the kit Switch.
        CreateOrderForm: ['Switch'],
        // Expiration is the shared ExpirationFields, whose Select lives in expirationChoice.jsx.
        CrossChainOrderForm: [],
        CrossChainSwapForm: [],
        // The explorer chooses with the Network field and a Tab strip now, not a radio group.
        DispenserExplorer: ['NetworkField', 'Tabs'],
        // Expiration is the shared ExpirationFields, and the fiat currency is the
        // Fiat currency field and picker page (G122), so no Select is left here.
        DispenserForm: [],
        // The Status and Sort filters; the auto-pay Switch moved to Order detail.
        MyOrdersView: ['Select'],
        OrderDetail: ['Switch'],
    };

    it.each(Object.entries(tradeChoicePrimitiveRoutes))('%s uses kit choice controls', (routeName, controls) => {
        const source = readFileSync(resolve(
            process.cwd(),
            `packages/core/src/shared/routes/${routeName}.jsx`,
        ), 'utf8');

        for (const control of controls) {
            expect(source).toMatch(new RegExp(`import\\s+\\{[^}]*\\b${control}\\b[^}]*\\}\\s+from\\s+'@xchain-wallet/core/ui'`, 's'));
            expect(source).toMatch(new RegExp(`<${control}\\b`));
        }
        expect(source).not.toMatch(/<input\b[^>]*type="(?:checkbox|radio)"/s);
        expect(source).not.toMatch(/kit has no (?:checkbox|radio)/i);
    });

    const nativeControlTargets = [
        'packages/core/src/shared/routes/CreateOrderForm.jsx',
        'packages/core/src/shared/routes/DispenserForm.jsx',
        'packages/core/src/shared/routes/SwapForm.jsx',
    ];

    it.each(nativeControlTargets)('%s uses kit fields and documents any native control exceptions', (file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');
        const rawInputs = source.match(/<input\b[^>]*>/g) || [];

        expect(source).not.toMatch(/<select\b/);
        expect(source).not.toMatch(/<textarea\b/);
        expect(rawInputs.every((tag) => /type="(?:checkbox|radio)"/.test(tag))).toBe(true);
        for (const rawInput of rawInputs) {
            const offset = source.indexOf(rawInput);
            expect(source.slice(Math.max(0, offset - 180), offset)).toMatch(
                /Native (?:checkboxes|radios) preserve [^\n]+ because the kit has no (?:checkbox|radio) primitive\./,
            );
        }
    });

    it('draws Swap\'s ownership and expiration choices with the kit controls Create order uses', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/core/src/shared/routes/SwapForm.jsx'), 'utf8');

        expect(source.match(/<input\b[^>]*>/g) || []).toEqual([]);
        // G44: a choice among a few named options is the icon dropdown, here
        // the shared ExpirationFields, whose Select lives in expirationChoice.jsx.
        expect(source).toMatch(/<ExpirationFields\b/);
        expect(source).not.toMatch(/<RadioGroup\b/);
        expect(source).not.toMatch(/<Checkbox\b/);
    });

    it.each([
        'packages/core/src/shared/routes/CreateOrderForm.jsx',
        'packages/core/src/shared/routes/DispenserForm.jsx',
        'packages/core/src/shared/routes/SwapForm.jsx',
    ])('%s has no advanced-options toggle button; the closed form sections replaced it', (file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');

        expect(source).not.toMatch(/<Button\b(?:(?!<\/Button>)[\s\S])*?Advanced options[\s\S]*?<\/Button>/);
        expect(source).not.toMatch(/styles\.advancedToggle/);
        expect(source).toMatch(/<FormSection\b/);
    });

    // The trade forms draw allow and block lists as ListField picker fields
    // like Token, never grey buttons (2026-11-13 Access lists note).
    it.each([
        'packages/core/src/shared/routes/CreateOrderForm.jsx',
        'packages/core/src/shared/routes/CrossChainSwapForm.jsx',
        'packages/core/src/shared/routes/SwapForm.jsx',
        'packages/core/src/shared/routes/DispenserForm.jsx',
    ])('%s draws its allow and block lists as picker fields', (file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');

        expect(source).toMatch(/<ListField\s+label="Allow list"/);
        expect(source).toMatch(/<ListField\s+label="Block list"/);
        expect(source).not.toMatch(/Set Allow-List|Set Block-List/);
        expect(source).not.toMatch(/styles\.choiceButtons/);
    });

    it('uses kit choice controls throughout the shared order panels', () => {
        const componentControls = {
            DerivationPathCrossCheck: ['Checkbox'],
            OpenOrdersPanel: ['Switch'],
            PlaceOrderPanel: ['Switch'],
            PreflightPanel: ['Checkbox'],
            // QR format is the themed dropdown, never radios (G119).
            WatcherExport: ['IconSelect'],
        };

        for (const [componentName, controls] of Object.entries(componentControls)) {
            const source = readFileSync(resolve(
                process.cwd(),
                `packages/core/src/shared/components/${componentName}.jsx`,
            ), 'utf8');

            for (const control of controls) {
                expect(source, componentName).toMatch(new RegExp(`<${control}\\b`));
            }
            expect(source, componentName).not.toMatch(/<input\b/);
        }
    });

    it('uses page, empty-state, select, and address primitives for matching jobs', () => {
        const createOrder = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/CreateOrderForm.jsx',
        ), 'utf8');
        const dispenser = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/DispenserForm.jsx',
        ), 'utf8');
        const swap = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/SwapForm.jsx',
        ), 'utf8');
        const placeOrder = withEnglishCopy(readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/PlaceOrderPanel.jsx',
        ), 'utf8'));

        // Receive at is a standard AddressField under You get, prefilled with
        // From, so it is no longer marked optional.
        expect(createOrder).toMatch(/<AddressField\s+label="Receive at"/);
        // G122: the fiat currency is the Fiat currency field (its label is the
        // component's own "Fiat currency"), optional on a dispenser.
        expect(dispenser).toMatch(/<FiatCurrencyField\s+id="dispenser-fiat-code"\s+optional/);
        expect(dispenser).not.toMatch(/Priced in fiat/);
        expect(dispenser).toMatch(/<AddressField[\s\S]*id="dispenser-oracle"/);
        // Swap's terms section carries the Optional tag, so its field carries none.
        expect(swap).toMatch(/<AddressField\s+label="Receive at"/);
        expect(placeOrder).toMatch(/<FormPage\b/);
        expect(placeOrder).toMatch(/<EmptyState\b/);
        expect(placeOrder).toMatch(/<Select[\s\S]*label="Expiration"/);
        // The Auto pay opt-in is the card's one switch (layout 3, 2026-11-13);
        // the acknowledgement moved to the confirm summary, so no checkbox is left.
        expect(placeOrder).not.toMatch(/<Checkbox\b/);
        expect(placeOrder.match(/<Switch\b/g)).toHaveLength(1);
        expect(placeOrder).toMatch(/<SegmentedControl\b/);
        expect(placeOrder).not.toMatch(/<button\b/);
    });

    it('uses style-guide controls throughout wallet setup routes', () => {
        const readRoute = (name) => readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${name}.jsx`),
            'utf8',
        );
        const sources = {
            addressList: readRoute('AddressList'),
            create: readRoute('CreateWallet'),
            import: readRoute('ImportWallet'),
            migrate: readRoute('MigrateToBip39'),
            onboarding: readRoute('Onboarding'),
            signerSelect: readRoute('SignerSelectForm'),
        };
        const { create: createSource, import: importSource } = sources;

        expect(importSource).toMatch(/\bTextarea\b/);
        expect(importSource).not.toMatch(/<textarea\b|<select\b/);
        expect(importSource).toMatch(/<Tabs\b/);
        expect(importSource).not.toMatch(/<button\b/);
        expect(createSource).not.toMatch(/<button\b|<textarea\b|<select\b/);
        expect(sources.addressList.match(/<Checkbox\b/g)).toHaveLength(1);
        expect(createSource.match(/<Checkbox\b/g)).toHaveLength(1);
        // The recovery phrase length is the icon dropdown (G44), not a radio list.
        expect(createSource).not.toMatch(/<RadioGroup\b/);
        expect(createSource.match(/<IconSelect\b/g)).toHaveLength(1);
        expect(createSource.match(/<Switch\b/g)).toHaveLength(1);
        expect(importSource.match(/<Checkbox\b/g)).toHaveLength(1);
        // The extra-passphrase switch only: the Backup tab dropped its overwrite switch.
        expect(importSource.match(/<Switch\b/g)).toHaveLength(1);
        expect(sources.migrate.match(/<Checkbox\b/g)).toHaveLength(1);
        expect(sources.onboarding.match(/<Checkbox\b/g)).toHaveLength(1);
        // The signer choice is the themed icon dropdown (G44), not a radio list.
        expect(sources.signerSelect.match(/<IconSelect\b/g)).toHaveLength(1);
        expect(sources.signerSelect).not.toMatch(/<RadioGroup\b/);
        for (const source of Object.values(sources)) {
            expect(source).not.toMatch(/type="(?:checkbox|radio)"/);
        }
    });

    it('uses style guide controls in the market, contact, preference, and token lists', () => {
        const readRoute = (routeName) => readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );
        const markets = readRoute('MarketsList');
        const contacts = readRoute('ContactsList');
        const preferences = readRoute('AddressPreferencesForm');
        const tokens = readRoute('MyTokens');

        expect(markets).toMatch(/<ListFilterMenu\b/);
        expect(markets).toMatch(/<Select\b/);
        expect(markets).toMatch(/<Button\b/);
        expect(markets).not.toMatch(/<button\b/);

        // The Addresses header (SectionHeader) left with the Addresses tab
        // (2026-11-15); the tab is the address list and its Add Address button.
        for (const component of ['AddressField', 'Input', 'Select', 'Textarea', 'Button', 'EmptyState', 'ListRow']) {
            expect(contacts).toContain(`<${component}`);
        }
        expect(contacts).not.toMatch(/<(?:button|input|select|textarea)\b/);

        expect(preferences).toMatch(/<FormSection\b/);
        expect(preferences).toMatch(/<FeeSection\b/);
        // The fee, require-memo and dispenser choices are icon selects, never
        // native radios or checkboxes.
        expect(preferences.match(/<IconSelect\b/g)).toHaveLength(3);
        expect(preferences).not.toMatch(/<(?:RadioGroup|Checkbox)\b/);
        expect(preferences).not.toMatch(/<(?:button|select|textarea)\b/);
        expect(preferences).not.toMatch(/<input\b/);

        expect(tokens).toMatch(/<ListFilterMenu\b/);
        expect(tokens).toMatch(/<IconSelect\b/);
        expect(tokens).toMatch(/<Button\b/);
        expect(tokens).toMatch(/<EmptyState\b/);
        expect(tokens).not.toMatch(/<(?:button|input|select)\b/);
    });
});
