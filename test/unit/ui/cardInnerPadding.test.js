// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const packagesRoot = join(repoRoot, 'packages');

// Every reviewed flush surface delegates its inset to each direct content row.
// Reasons stay beside the exception so a new flush composition requires review.
const REVIEWED_PADDED_ROW_CONTAINERS = {
    'packages/core/src/shared/components/BalanceList.module.css | .list': 'Balance rows and the hidden-balances toggle carry their own padding.',
    'packages/core/src/shared/components/CollectiblesView.module.css | .card': 'The sole cardContent child uses the shared card padding token.',
    'packages/core/src/shared/components/ContactsPickerScreen.module.css | .abList': 'Every contact is rendered through a padded ListRow.',
    'packages/core/src/shared/components/HomeTabs.module.css | .demoList': 'Activity and DeFi row buttons carry their own padding.',
    'packages/core/src/shared/routes/AddressList.module.css | .addrList': 'Picker actions and address entries are padded ListRow children.',
    'packages/core/src/shared/routes/ContactsList.module.css | .list': 'Every contact entry is a padded ListRow.',
    'packages/core/src/shared/routes/CrossChainTemplates.module.css | .list': 'Every template article carries the shared list-row padding.',
    'packages/core/src/shared/routes/DispenserDetail.module.css | .dispenseList': 'Lifecycle and dispense entries are padded ListRow children.',
    'packages/core/src/shared/routes/DispensersList.module.css | .list': 'Every dispenser row carries its own padding.',
    'packages/core/src/shared/routes/History.module.css | .rowList': 'Every history ActivityRow carries the shared card padding.',
    'packages/core/src/shared/routes/IssueTokenForm.module.css | .accessListGroup': 'Every access-list row carries the shared list-row padding.',
    'packages/core/src/shared/routes/MarketActivity.module.css | .list': 'Every market activity entry is a padded ListRow.',
    'packages/core/src/shared/routes/MarketsList.module.css | .marketsCard': 'Market rows and the pagination surface each carry their own padding.',
    'packages/core/src/shared/routes/MyLists.module.css | .list': 'Every saved-list row carries its own padding.',
    'packages/core/src/shared/routes/MyTokens.module.css | .list': 'Every token entry is a padded ListRow.',
    'packages/core/src/shared/routes/ObligationsView.module.css | .list': 'Every obligation row carries its own padding.',
    'packages/core/src/shared/routes/PairSignerForm.module.css | .vendorGrid': 'Every vendor row is a kit Button with its own padding.',
    'packages/core/src/shared/routes/Settings.module.css | .settingsList': 'Every drill or panel row carries the shared list-row padding.',
    'packages/core/src/shared/routes/StakeDetail.module.css | .eventList': 'Every stake event is rendered through a padded ListRow.',
    'packages/core/src/shared/routes/StakeNew.module.css | .chainList': 'Every chain choice is a padded ListRow.',
    'packages/core/src/shared/routes/StakeNew.module.css | .options': 'Every staking choice is a padded ListRow.',
    'packages/core/src/shared/routes/StakingList.module.css | .list': 'Every staking row button carries its own padding.',
    'packages/core/src/shared/routes/TokenWizard.module.css | .templateGrid': 'Every template choice carries its own row padding.',
    'packages/core/src/shared/routes/WalletPicker.module.css | .detailList': 'Every wallet metadata row carries its own padding.',
    'packages/web/src/style-guide/sections/AddressListSection.module.css | .abList': 'The style-guide address rows carry their own padding.',
    'packages/web/src/style-guide/sections/BalanceListSection.module.css | .list': 'The style-guide balance rows carry their own padding.',
    'packages/web/src/style-guide/sections/TokenSelectorSection.module.css | .list': 'The style-guide token rows carry their own padding.',
    'packages/web/src/style-guide/sections/templateExamples.module.css | .list': 'The template example rows carry their own padding.',
};

// Flush surfaces another ruling owns; empty since U32 moved the licence terms to the padded card.
const SEPARATELY_OWNED_FLUSH_SURFACES = {};

function cssModules(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules') return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return cssModules(path);
        return entry.name.endsWith('.module.css') ? [path] : [];
    });
}

function relativePath(path) {
    return relative(repoRoot, path).split(sep).join('/');
}

function flushSurfaces(path) {
    const source = readFileSync(path, 'utf8');
    const found = [];
    const declaration = /\bcomposes:\s*flush\s+from\s+['"][^'"]*\/Card\.module\.css['"]\s*;/g;
    for (const match of source.matchAll(declaration)) {
        const ruleOpen = source.lastIndexOf('{', match.index);
        const previousRuleClose = source.lastIndexOf('}', ruleOpen);
        const selector = source
            .slice(previousRuleClose + 1, ruleOpen)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim()
            .replace(/\s+/g, ' ');
        found.push(`${relativePath(path)} | ${selector}`);
    }
    return found;
}

describe('card inner padding', () => {
    it('limits flush cards to reviewed padded-row containers', () => {
        const actual = cssModules(packagesRoot).flatMap(flushSurfaces).sort();
        const reviewed = Object.keys(REVIEWED_PADDED_ROW_CONTAINERS);
        const separatelyOwned = Object.keys(SEPARATELY_OWNED_FLUSH_SURFACES);

        expect(actual).toEqual([...reviewed, ...separatelyOwned].sort());
        expect(Object.values(REVIEWED_PADDED_ROW_CONTAINERS).every((reason) => reason && !reason.includes('\n'))).toBe(true);
        expect(Object.values(SEPARATELY_OWNED_FLUSH_SURFACES).every((reason) => reason && !reason.includes('\n'))).toBe(true);
    });
});
