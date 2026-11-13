// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migratedRoutes = [
    'ActionsMenu',
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
    ListCreateForm: ['Button', 'Checkbox', 'Input', 'Select', 'Textarea'],
    ListForkForm: ['Button', 'Checkbox', 'Input', 'Textarea'],
    MarketActivity: ['Button'],
    MarketView: ['Button'],
    MultisigCreate: ['Button', 'Input', 'Select'],
    PairSignerForm: ['Button', 'Input'],
    PollDetail: ['Button', 'Checkbox', 'Input'],
    UnionListForm: ['Button', 'Checkbox', 'Input'],
    Send: ['Button', 'Checkbox', 'Switch'],
};
const choiceControlRoutes = {
    History: ['Checkbox', 'RadioGroup'],
    Send: ['Checkbox', 'Switch'],
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
    'GovernancePolls',
    'MarketActivity',
    // My bets is the Bet Markets tab drawn by BetMyBetsPanel.
    '../components/BetMyBetsPanel',
    'MyLists',
];

const choicePrimitiveRoutes = {
    AttachContentForm: ['Checkbox'],
    // The publish forms carry no acknowledgement checkbox; permanence is a
    // confirm-screen notice.
    GatedPublishForm: ['RadioGroup'],
    PublishFileForm: ['RadioGroup'],
    SleepForm: ['RadioGroup'],
};
const tokenControlRoutes = [
    ['IssueTokenForm', { Switch: 2 }],
    // Lock token's flags are Issue-style lock switches; the bridge checkboxes stay.
    ['TokenAdminForm', { Checkbox: 2, Switch: 1 }],
    // The sweep's one checkbox group is the category list; its acknowledgement
    // moved to the confirm screen.
    ['SweepForm', { Checkbox: 1 }],
    ['StakeForm', { RadioGroup: 1 }],
    ['ContractStakeForm', { RadioGroup: 1 }],
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

        expect(source).toMatch(/import\s+\{[^}]*\bRadioGroup\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<RadioGroup\b/);
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
        ['Settings', ['Button', 'Input'], 1],
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
        if (routeName === 'CoinpayForm') {
            expect(nativeButtons).toHaveLength(1);
            expect(source).toMatch(/native row button keeps the whole .* card as one target/);
        } else {
            expect(nativeButtons).toHaveLength(0);
        }
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
        expect(walletMode).toMatch(/import\s+\{[^}]*\bRadioGroup\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        expect(walletMode).toMatch(/<RadioGroup\b/);
        expect(walletMode).not.toMatch(/<input\b/);
    });
});

describe('trade form style guide primitives', () => {
    const tradeChoicePrimitiveRoutes = {
        // The acknowledgement checkboxes left these forms with the confirm summary.
        CreateOrderForm: ['RadioGroup', 'Switch'],
        CrossChainOrderForm: ['RadioGroup'],
        CrossChainSwapForm: ['RadioGroup'],
        // The explorer chooses with a Select and a Tab strip now, not a radio group.
        DispenserExplorer: ['Select', 'Tabs'],
        DispenserForm: ['RadioGroup'],
        MyOrdersView: ['Switch'],
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
        expect(source).toMatch(/<RadioGroup\s+legend="Expiration"/);
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

    it.each([
        'packages/core/src/shared/routes/CreateOrderForm.jsx',
        'packages/core/src/shared/routes/DispenserForm.jsx',
        'packages/core/src/shared/routes/SwapForm.jsx',
    ])('%s groups its allow-list and block-list buttons under one field-style label', (file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');

        // The label may carry its own help tip, and an Optional pill only where
        // its section does not already carry the Optional tag.
        expect(source).toMatch(/<p className=\{styles\.choiceGroupLabel\}>\s*Restrict who can (?:buy|match)(?: <OptionalPill \/>)?(?:\s*<InfoTip [^>]*\/>)?\s*<\/p>\s*<div className=\{styles\.choiceButtons\}>/);
        expect(source).not.toMatch(/Restrict who can (?:buy|match)(?: <OptionalPill \/>)?(?:\s*<InfoTip [^>]*\/>)?\s*<\/p>\s*<div className=\{styles\.actions\}>/);
    });

    it('uses kit choice controls throughout the shared order panels', () => {
        const componentControls = {
            DerivationPathCrossCheck: ['Checkbox'],
            OpenOrdersPanel: ['Switch'],
            PlaceOrderPanel: ['Checkbox'],
            PreflightPanel: ['Checkbox'],
            WatcherExport: ['RadioGroup'],
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

        // Optional shows as the Optional pill from the prop (U56).
        expect(createOrder).toMatch(/<AddressField\s+label="Receive at(?: \(optional\)"|"\s+optional)/);
        expect(dispenser).toMatch(/<Select[\s\S]*label="Priced in fiat(?: \(optional\)"|"\s+optional)/);
        expect(dispenser).toMatch(/<AddressField[\s\S]*id="dispenser-oracle"/);
        // Swap's terms section carries the Optional tag, so its field carries none.
        expect(swap).toMatch(/<AddressField\s+label="Receive at"/);
        expect(placeOrder).toMatch(/<FormPage\b/);
        expect(placeOrder).toMatch(/<EmptyState\b/);
        expect(placeOrder).toMatch(/<Select[\s\S]*label="Expiration"/);
        // The auto-pay opt-in is the one checkbox left; the acknowledgement
        // moved to the confirm summary.
        expect(placeOrder.match(/<Checkbox\b/g)).toHaveLength(1);
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
        expect(createSource.match(/<RadioGroup\b/g)).toHaveLength(1);
        expect(createSource.match(/<Switch\b/g)).toHaveLength(1);
        expect(importSource.match(/<Checkbox\b/g)).toHaveLength(1);
        expect(importSource.match(/<Switch\b/g)).toHaveLength(2);
        expect(sources.migrate.match(/<Checkbox\b/g)).toHaveLength(1);
        expect(sources.onboarding.match(/<Checkbox\b/g)).toHaveLength(1);
        expect(sources.signerSelect.match(/<RadioGroup\b/g)).toHaveLength(1);
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

        for (const component of ['AddressField', 'Input', 'Select', 'Textarea', 'Button', 'EmptyState', 'SectionHeader']) {
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
