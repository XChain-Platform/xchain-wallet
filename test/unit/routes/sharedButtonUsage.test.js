// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
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
    MultisigCreate: ['Button', 'Input', 'RadioGroup', 'Select'],
    PairSignerForm: ['Button', 'Input'],
    PollDetail: ['Button', 'Checkbox', 'Input'],
    UnionListForm: ['Button', 'Checkbox', 'Input'],
    Send: ['Button', 'Checkbox', 'Switch'],
};
const choiceControlRoutes = {
    History: ['Checkbox', 'RadioGroup'],
    MultisigCreate: ['RadioGroup'],
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
    'MyBets',
    'MyLists',
];

const choicePrimitiveRoutes = {
    AttachContentForm: ['Checkbox'],
    BroadcastForm: ['RadioGroup', 'Switch'],
    GatedPublishForm: ['Checkbox', 'RadioGroup'],
    LinkForm: ['RadioGroup'],
    SleepForm: ['RadioGroup'],
};
const tokenControlRoutes = [
    ['IssueTokenForm', { Switch: 2 }],
    ['TokenAdminForm', { Checkbox: 3 }],
    ['TokenWizard', { Checkbox: 1, Switch: 2 }],
    ['SweepForm', { Checkbox: 2 }],
    ['StakeForm', { RadioGroup: 1 }],
    ['ContractStakeForm', { RadioGroup: 1 }],
];

describe('shared route button usage', () => {
    it.each([
        'ImportWallet',
        'MarketsList',
        'TokenDetail',
        'TokenPicker',
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

    it('uses Checkbox and documents the remaining native radio exceptions', () => {
        const source = ['ParallelComposer', 'PublishFileForm']
            .map((routeName) => readFileSync(
                resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
                'utf8',
            ))
            .join('\n');
        const inputs = source.match(/<input\b/g) || [];
        const rationales = source.match(/The kit has no (?:checkbox|radio) primitive/g) || [];
        const checkboxes = source.match(/<Checkbox\b/g) || [];

        expect(source).toMatch(/import\s+\{[^}]*\bCheckbox\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(checkboxes).toHaveLength(2);
        expect(inputs).toHaveLength(2);
        expect(rationales).toHaveLength(inputs.length);
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
        ['SignMessageForm', ['Button', 'CopyButton', 'Select', 'Textarea'], 0],
        ['TokenPicker', ['Button', 'Input', 'Tabs'], 0],
        ['VerifySignatureForm', ['Button', 'Input', 'Textarea'], 0],
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
            'packages/core/src/shared/components/settings/WalletModeSection.jsx',
        ), 'utf8');

        expect(primitives).toMatch(/import\s+\{\s*Switch\s*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        expect(primitives).toMatch(/<Switch\b/);
        expect(primitives).not.toMatch(/<input\b/);
        expect(walletMode).toMatch(/import\s+\{\s*RadioGroup\s*\}\s+from\s+'@xchain-wallet\/core\/ui'/);
        expect(walletMode).toMatch(/<RadioGroup\b/);
        expect(walletMode).not.toMatch(/<input\b/);
    });
});

describe('trade form style guide primitives', () => {
    const tradeChoicePrimitiveRoutes = {
        CreateOrderForm: ['Checkbox', 'RadioGroup', 'Switch'],
        CrossChainOrderForm: ['Checkbox', 'RadioGroup'],
        CrossChainSwapForm: ['Checkbox', 'RadioGroup'],
        DispenserExplorer: ['RadioGroup'],
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
        expect((source.match(/<Checkbox\b/g) || []).length).toBe(2);
    });

    it('uses kit choice controls throughout the shared order panels', () => {
        const componentControls = {
            DerivationPathCrossCheck: ['Checkbox'],
            OpenOrdersPanel: ['Switch'],
            PlaceOrderPanel: ['Checkbox'],
            PreflightPanel: ['Checkbox'],
            WatcherResultPanel: ['RadioGroup'],
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
        const placeOrder = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/PlaceOrderPanel.jsx',
        ), 'utf8');

        expect(createOrder).toMatch(/<AddressField\s+label="Receive at \(optional\)"/);
        expect(dispenser).toMatch(/<Select[\s\S]*label="Priced in fiat \(optional\)"/);
        expect(dispenser).toMatch(/<AddressField[\s\S]*id="dispenser-oracle"/);
        expect(swap).toMatch(/<AddressField\s+label="Receive at \(optional\)"/);
        expect(placeOrder).toMatch(/<FormPage\b/);
        expect(placeOrder).toMatch(/<EmptyState\b/);
        expect(placeOrder).toMatch(/<Select[\s\S]*label="Expiration"/);
        expect(placeOrder.match(/<Checkbox\b/g)).toHaveLength(2);
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
        expect(importSource).toMatch(
            /import\s+\{\s*ClipboardPasteButton\s*\}\s+from\s+'\.\.\/\.\.\/ui\/ClipboardPasteButton\.jsx'/,
        );
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

        expect(markets).toMatch(/<Input\b/);
        expect(markets).toMatch(/<Button\b/);
        expect(markets).toMatch(/<Tabs\b/);
        expect(markets).not.toMatch(/<button\b/);

        for (const component of ['AddressField', 'Input', 'Select', 'Textarea', 'Button', 'EmptyState', 'SectionHeader']) {
            expect(contacts).toContain(`<${component}`);
        }
        expect(contacts).not.toMatch(/<(?:button|input|select|textarea)\b/);

        expect(preferences).toMatch(/<FormSection\b/);
        expect(preferences).toMatch(/<FeeSelector\b/);
        expect(preferences.match(/<RadioGroup\b/g)).toHaveLength(2);
        expect(preferences).not.toMatch(/<(?:button|select|textarea)\b/);
        expect(preferences.match(/<input\b/g)).toHaveLength(1);
        expect(preferences.match(/type="checkbox"/g)).toHaveLength(1);

        expect(tokens).toMatch(/<Input\b/);
        expect(tokens).toMatch(/<Button\b/);
        expect(tokens).toMatch(/<EmptyState\b/);
        expect(tokens.match(/<button\b/g)).toHaveLength(2);
        expect(tokens.match(/role="radio"/g)).toHaveLength(2);
    });
});
