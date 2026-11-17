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
    'packages/core/src/shared/commandPalette/CommandPalette.module.css | .groupList': 'Every command result row carries its own padding in one divided list card.',
    'packages/core/src/shared/commandPalette/CommandPalette.module.css | .walletGroup': 'Each wallet menu group heading and row button carries its own padding.',
    'packages/core/src/shared/components/ActionList.module.css | .list': 'Every action is a padded ListRow in one divided list card (G101).',
    'packages/core/src/shared/components/BalanceList.module.css | .list': 'Balance rows and the hidden-balances toggle carry their own padding.',
    'packages/core/src/shared/components/CollectiblesView.module.css | .card': 'The sole cardContent child uses the shared card padding token.',
    'packages/core/src/shared/components/ContactsPickerScreen.module.css | .abList': 'Every contact is rendered through a padded ListRow.',
    'packages/core/src/shared/components/FiatCurrency.module.css | .list': 'Every currency is rendered through a padded ListRow (G122).',
    'packages/core/src/shared/components/HomeTabs.module.css | .demoList': 'Activity and DeFi row buttons carry their own padding.',
    'packages/core/src/shared/components/MultiSendRecipients.module.css | .list': 'Every Send Multi recipient is a padded ListRow, and a row being edited pads its own form.',
    'packages/core/src/shared/components/formStandard/formStandard.module.css | .optionalSection': 'Each form section is its own card whose header and expanded content carry their own padding.',
    'packages/core/src/shared/routes/AddressList.module.css | .addrList': 'Picker actions and address entries are padded ListRow children.',
    'packages/core/src/shared/routes/AlertsRoute.module.css | .list': 'Every notification row button carries the list row padding.',
    'packages/core/src/shared/routes/ContactsList.module.css | .list': 'Every contact entry is a padded ListRow.',
    'packages/core/src/shared/routes/ContractScreens.module.css | .list': 'Every contract row is a padded ListRow.',
    'packages/core/src/shared/routes/CreateBetFeedForm.module.css | .resultFacts': 'The submitted screen facts are padded ListRows.',
    'packages/core/src/shared/routes/DispenserDetail.module.css | .dispenseList': 'Lifecycle and dispense entries are padded ListRow children.',
    'packages/core/src/shared/routes/DispenserExplorer.module.css | .cardList': 'Every dispenser row carries its own padding in one divided list card.',
    'packages/core/src/shared/routes/DispensersList.module.css | .list': 'Every dispenser row carries its own padding.',
    'packages/core/src/shared/routes/GovernancePolls.module.css | .pollList': 'Every poll is a padded ListRow in one divided list card (U41).',
    'packages/core/src/shared/routes/History.module.css | .rowList': 'Every history ActivityRow carries the shared card padding.',
    'packages/core/src/shared/routes/BetFeedDetail.module.css | .facts': 'Every fact row carries the card inset (.factRow).',
    'packages/core/src/shared/routes/OutcomeList.module.css | .list': 'Every bet outcome is a padded ListRow in one divided list card.',
    'packages/core/src/shared/components/outcomeDetail/OutcomeDetail.module.css | .activityList': 'Every bet or vote row on the shared outcome page carries the card inset (.activityRow).',
    'packages/core/src/shared/components/outcomeDetail/OutcomeDetail.module.css | .facts': 'Every fact row on the shared outcome page carries the card inset (.factRow).',
    'packages/core/src/shared/components/settings/AboutSection.module.css | .card': 'Every About fact is a padded ListRow, and the update switch item carries its own padding, in one divided list card (G08).',
    'packages/core/src/shared/components/settings/ConnectedSitesSection.module.css | .list': 'Every allowed site, blocked entry and site fact is a padded ListRow.',
    'packages/core/src/shared/components/settings/AppearancePages.module.css | .list': 'Every Appearance choice and inline setting is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/components/settings/HideSmallBalancesPage.module.css | .card': 'The switch row and every balance preview row is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/components/settings/NetworkRowsPage.module.css | .card': 'Every network row is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/components/settings/NetworkEndpointsSection.module.css | .refreshList': 'The registry refresh action is a padded ListRow in its own list card (G08).',
    'packages/core/src/shared/components/settings/PriceAlertsSection.module.css | .detailList': 'Every price alert fact row carries the card inset (.detailRow) in one divided list card.',
    'packages/core/src/shared/components/settings/PriceAlertsSection.module.css | .list': 'Every price alert is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/components/settings/TestNetworksPages.module.css | .card': 'Every test network and faucet request is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/components/settings/TokenListsSection.module.css | .list': 'Every token list action is a padded ListRow in one divided list card (G08).',
    'packages/core/src/shared/routes/IssueTokenForm.module.css | .optionalSection': 'Each Issue section is its own card whose header and expanded content carry their own padding (U80).',
    'packages/core/src/shared/routes/ListDetail.module.css | .itemList': 'Every member or edit row carries its own padding in one divided list card (U41).',
    'packages/core/src/shared/routes/Locked.module.css | .restoreCard': 'The two Forgot Password restore choices are padded ListRow children in one divided list card.',
    'packages/core/src/shared/routes/MarketActivity.module.css | .list': 'Every market activity entry is a padded ListRow.',
    'packages/core/src/shared/routes/MessagingInbox.module.css | .convList': 'Every conversation row button carries its own padding (.convItem) in one divided list card (U41).',
    'packages/core/src/shared/routes/MarketActivity.module.css | .listCard': 'Each tab list card pads its own title row and plain line, and its entries are padded ListRow children.',
    'packages/core/src/shared/routes/MarketsList.module.css | .marketsCard': 'Market rows and the pagination surface each carry their own padding.',
    'packages/core/src/shared/routes/MultisigSigningSession.module.css | .list': 'Every multisig session row is a padded ListRow with a chevron in one divided list card (G07, U41).',
    'packages/core/src/shared/routes/MyLists.module.css | .list': 'Every saved-list row carries its own padding.',
    'packages/core/src/shared/routes/CoSignerAccountDetail.module.css | .rows': 'Every holdings and activity row is a list item that carries its own padding.',
    'packages/core/src/shared/routes/CoSignerAccountList.module.css | .list': 'Every agent account entry is a padded ListRow (U41, U58).',
    'packages/core/src/shared/routes/MyTokens.module.css | .list': 'Every token entry is a padded ListRow.',
    'packages/core/src/shared/routes/ObligationsView.module.css | .list': 'Every obligation row carries its own padding.',
    'packages/core/src/shared/routes/OracleRecord.module.css | .marketList': 'Every market row carries the card inset (.marketRow).',
    'packages/core/src/shared/routes/PairSignerForm.module.css | .list': 'Every network and account row is a padded ListRow (.row).',
    'packages/core/src/shared/routes/ProjectRosterForm.module.css | .rosterList': 'Every token is a padded ListRow inside the form list card (U41, U58).',
    'packages/core/src/shared/routes/Settings.module.css | .settingsList': 'Every drill or panel row carries the shared list-row padding.',
    'packages/core/src/shared/routes/StakeDetail.module.css | .eventList': 'Every stake event is rendered through a padded ListRow.',
    'packages/core/src/shared/routes/StakingList.module.css | .list': 'Every staking row button carries its own padding.',
    'packages/core/src/shared/routes/WalletPicker.module.css | .detailList': 'Every wallet metadata row carries its own padding.',
    'packages/core/src/ui/OptionSwitchList.module.css | .list': 'G118: one flush card of switch rows; every OptionSwitch row carries its own card-pad padding.',
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
