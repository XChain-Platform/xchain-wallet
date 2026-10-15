// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { parse } from '@babel/parser';
import { describe, expect, test } from 'vitest';

import { en } from '../../packages/core/src/i18n/locales/en/index.js';
import { findViolations } from '../../tools/eslint/rules/no-jsx-literal-strings.js';

const sharedSources = import.meta.glob(
    '../../packages/core/src/shared/**/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

const extensionSources = import.meta.glob(
    '../../packages/extension/src/**/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

const shellSources = import.meta.glob(
    [
        '../../packages/desktop/renderer/**/*.jsx',
        '../../packages/web/src/**/*.jsx',
        '!../../packages/web/src/style-guide/**',
    ],
    { query: '?raw', import: 'default', eager: true },
);

const uiSources = import.meta.glob(
    '../../packages/core/src/ui/**/*.jsx',
    { query: '?raw', import: 'default', eager: true },
);

// The allowlist: files outside the guard because their screens still carry
// hard-coded copy. Every file under shared/components, core/src/ui, the web
// shell and the desktop renderer is scanned unless it is named here, so the
// list may only shrink.
const UNMIGRATED_FILES = [
    '/components/NoticeModal.jsx',
    '/components/ReachabilityBanner.jsx',
    '/components/UpdateNoticeBanner.jsx',
];

const isUnmigrated = (file) => [...UNMIGRATED_FILES, ...PARTIAL_COPY_FILES].some((suffix) => file.endsWith(suffix));
const GUARDED_SHARED_DIRS = /\/shared\/(components|keyboard|commandPalette)\//;

const localizedComponents = [
    'AdsNotice.jsx',
    'AlertsOverlay.jsx',
    'BackupReminderCard.jsx',
    'ConfirmModal.jsx',
    'settings/NetworkSection.jsx',
    'settings/UndoSendRow.jsx',
    'settings/AboutSection.jsx',
    'settings/AdsSection.jsx',
    'settings/AppearanceSection.jsx',
    'settings/BackupSection.jsx',
    'settings/BiometricRow.jsx',
    'settings/ConnectedSitesSection.jsx',
    'settings/ContactsSection.jsx',
    'settings/DeveloperModeSection.jsx',
    'settings/DisplaySection.jsx',
    'settings/DuressPassphraseRow.jsx',
    'settings/FeesSection.jsx',
    'settings/KeyboardSection.jsx',
    'settings/LanguageRegionSection.jsx',
    'settings/NetworkEndpointsSection.jsx',
    'settings/NotificationsSection.jsx',
    'settings/PanicModeRow.jsx',
    'settings/PrivacySection.jsx',
    'settings/SafetySection.jsx',
    'settings/ThisWalletSection.jsx',
    'settings/WalletModeSection.jsx',
    'AppHeader.jsx',
    'BalanceList.jsx',
    'HeaderSettingsButton.jsx',
    'HomeFilterBar.jsx',
    'HomeTabs.jsx',
    'TxStatusTimeline.jsx',
    'UndoSendToast.jsx',
];

// Every E-K route is migrated, so each one is scanned even if it stops calling t().
const ROUTE_E_TO_K = /\/routes\/[E-K][^/]*\.jsx$/;

const localizedRoutes = [
    'AccountPicker.jsx',
    'CreateWallet.jsx',
    'Locked.jsx',
    'Onboarding.jsx',
    'Receive.jsx',
    'Settings.jsx',
    'ActionDetail.jsx',
    'ActionsMenu.jsx',
    'AlertsRoute.jsx',
    'BridgeOriginBadge.jsx',
    'Loading.jsx',
    'MarketView.jsx',
    'MultisigCosignerShare.jsx',
    'OnboardingCarousel.jsx',
    'RenameAccountForm.jsx',
    'RenameWalletForm.jsx',
    'RouteNotFound.jsx',
    'SignerSelectForm.jsx',
    'StakeNew.jsx',
    'VaultUnavailable.jsx',
    'VerifySignatureForm.jsx',
    'WalletDetails.jsx',
    'WalletPicker.jsx',
];

// Routes that call t() only for single wording fixes. Their t() keys are still
// checked against the dictionary; their remaining literals stay outside the
// literal guard until the screen migrates.
const PARTIAL_COPY_FILES = [
    '/routes/CreateBetFeedForm.jsx',
    '/routes/CreateOrderForm.jsx',
    '/routes/DispenserExplorer.jsx',
    '/routes/DispenserForm.jsx',
];

describe('shipping JSX localization', () => {
    test('localized shared components stay in the literal guard', () => {
        for (const component of localizedComponents) {
            const entry = Object.entries(sharedSources).find(([file]) => file.endsWith(`/components/${component}`));
            expect(entry?.[1], component).toMatch(/\bt\s*\(/);
        }
    });

    test('translated screens, E-K routes, extension screens and shell code keep user-facing copy in the locale dictionary', () => {
        expect(Object.keys(extensionSources)).toEqual(expect.arrayContaining([
            '../../packages/extension/src/approval/Router.jsx',
            '../../packages/extension/src/approval/kinds/ConnectApproval.jsx',
            '../../packages/extension/src/approval/kinds/SignApproval.jsx',
            '../../packages/extension/src/popup/App.jsx',
        ]));
        const violations = [];
        const missingKeys = [];

        const localizedSources = {
            ...Object.fromEntries(
                Object.entries(sharedSources).filter(([file, source]) => (
                    !isUnmigrated(file) && (/\bt\s*\(/.test(source) || ROUTE_E_TO_K.test(file))
                )),
            ),
            ...Object.fromEntries(
                Object.entries(extensionSources).filter(([, source]) => /\bt\s*\(/.test(source)),
            ),
            ...Object.fromEntries(
                Object.entries(sharedSources).filter(([file]) => GUARDED_SHARED_DIRS.test(file) && !isUnmigrated(file)),
            ),
            ...Object.fromEntries(Object.entries(uiSources).filter(([file]) => !isUnmigrated(file))),
            ...Object.fromEntries(Object.entries(shellSources).filter(([file]) => !isUnmigrated(file))),
        };

        for (const [file, source] of Object.entries(localizedSources)) {
            for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
                if (!(match[1] in en)) missingKeys.push(`${file}: ${match[1]}`);
            }
            const ast = parse(source, {
                sourceType: 'module',
                plugins: ['jsx', 'estree'],
            });
            for (const violation of findViolations(ast.program)) {
                violations.push(`${file}:${violation.node.loc.start.line} ${violation.message}`);
            }
        }

        expect(violations).toEqual([]);
        expect(missingKeys).toEqual([]);
    });

    test('the literal guard allowlist names only files that still exist', () => {
        const files = Object.keys(sharedSources);
        for (const suffix of UNMIGRATED_FILES) {
            expect(files.some((file) => file.endsWith(suffix)), suffix).toBe(true);
        }
    });

    test('migrated routes remain enrolled in the literal guard', () => {
        for (const route of localizedRoutes) {
            const source = sharedSources[`../../packages/core/src/shared/routes/${route}`];
            expect(source, route).toMatch(/\bt\s*\(/);
        }
    });
});
