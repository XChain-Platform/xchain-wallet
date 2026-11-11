// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes');
const COMPONENTS = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'components');

const FEELESS_FORMS = [
    'AddressPreferencesForm.jsx',
    'AttachContentForm.jsx',
    'BroadcastForm.jsx',
    'DestroyForm.jsx',
    'LinkForm.jsx',
    'OracleForm.jsx',
    'PublishFileForm.jsx',
    'SleepForm.jsx',
    'TokenAdminForm.jsx',
];

const FEE_BEARING_SURFACES = new Set([
    'components/PlaceOrderPanel.jsx',
    'routes/AdvancedActionsForm.jsx',
    'routes/AirdropForm.jsx',
    'routes/BatchComposerForm.jsx',
    'routes/BetFeedDetail.jsx',
    'routes/BridgeMoveForm.jsx',
    'routes/CallbackForm.jsx',
    'routes/CreateBetFeedForm.jsx',
    'routes/CreateOrderForm.jsx',
    'routes/CrossChainOrderForm.jsx',
    'routes/CrossChainSwapForm.jsx',
    'routes/DeployContractForm.jsx',
    'routes/DispenserDetail.jsx',
    'routes/DispenserForm.jsx',
    'routes/DividendForm.jsx',
    'routes/ExecuteContractForm.jsx',
    'routes/IssueTokenForm.jsx',
    'routes/ListCreateForm.jsx',
    'routes/ListForkForm.jsx',
    'routes/ListRenameForm.jsx',
    'routes/ListShareForm.jsx',
    'routes/SellOwnershipForm.jsx',
    'routes/SwapForm.jsx',
    'routes/SweepForm.jsx',
    'routes/TokenWizard.jsx',
]);

function feeControlSurfaces() {
    const surfaces = [];
    for (const [kind, dir] of [['components', COMPONENTS], ['routes', ROUTES]]) {
        for (const file of readdirSync(dir)) {
            if (!file.endsWith('.jsx') || file === 'NativeFeeToggle.jsx' || file === 'FeesCard.jsx') continue;
            const source = readFileSync(join(dir, file), 'utf8');
            if (source.includes('<NativeFeeToggle') || source.includes('<FeesCard')) {
                surfaces.push(`${kind}/${file}`);
            }
        }
    }
    return surfaces;
}

describe('fee surface adoption', () => {
    for (const file of FEELESS_FORMS) {
        it(`${file} keeps only the Network fee field`, () => {
            const source = readFileSync(join(ROUTES, file), 'utf8');
            expect(source).not.toContain('NativeFeeToggle');
            expect(source).not.toContain('useNativeFee');
            expect(source).toContain('nativeFeeForFeelessAction');
        });
    }

    it('keeps Mint free of every protocol fee path', () => {
        const source = readFileSync(join(ROUTES, 'MintForm.jsx'), 'utf8');
        expect(source).not.toContain('NativeFeeToggle');
        expect(source).not.toContain('useNativeFee');
        expect(source).not.toContain('nativeFeeForFeelessAction');
        expect(source).not.toContain('payFeeInNativeCoin');
    });

    it('limits fee controls to fee-bearing surfaces', () => {
        const surfaces = feeControlSurfaces();
        expect(surfaces.length).toBeGreaterThan(20);
        expect(surfaces.filter((surface) => !FEE_BEARING_SURFACES.has(surface))).toEqual([]);
    });

    it('gates the advanced action fee controls on the selected action', () => {
        const source = readFileSync(join(ROUTES, 'AdvancedActionsForm.jsx'), 'utf8');
        expect(source).toMatch(/isFeeBearingAction\(action,\s*\{ newToken: action === 'ISSUE' \}\)\s*\?\s*\(/);
    });
});
