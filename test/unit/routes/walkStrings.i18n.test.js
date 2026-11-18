// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import pseudoRtl from '../../../packages/core/src/i18n/locales/pseudo-rtl/index.js';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';
import {
    ACTION_ENTRY_DEFS,
    buildActionEntries,
} from '../../../packages/core/src/shared/actionEntries.js';

const routeSources = import.meta.glob(
    [
        '../../../packages/core/src/shared/routes/ContractsList.jsx',
        '../../../packages/core/src/shared/routes/DispensersList.jsx',
        '../../../packages/core/src/shared/routes/StakeDetail.jsx',
    ],
    { query: '?raw', import: 'default', eager: true },
);

const sourceNamed = (name) => Object.entries(routeSources)
    .find(([path]) => path.endsWith(`/${name}`))?.[1] || '';

afterEach(async () => {
    await setLocale('en');
});

describe('walk-era strings use the locale catalogs', () => {
    it('keeps the English and pseudo-RTL route copy in sync', () => {
        const expected = {
            'routes.contractsList.myContracts': 'My Contracts',
            'routes.dispensersList.myDispensers': 'My Dispensers',
            'routes.stakeDetail.stakedWithRewards': 'Staked + rewards',
        };

        for (const [key, value] of Object.entries(expected)) {
            expect(en[key]).toBe(value);
            expect(pseudoRtl[key]).toContain(`⟦${value}⟧`);
        }
    });

    it('renders each route string through t(), including the chart accessibility label', () => {
        const contracts = sourceNamed('ContractsList.jsx');
        const dispensers = sourceNamed('DispensersList.jsx');
        const stake = sourceNamed('StakeDetail.jsx');

        expect(contracts).toContain("t('routes.contractsList.myContracts')");
        expect(dispensers).toContain("t('routes.dispensersList.myDispensers')");
        expect(stake.match(/t\('routes\.stakeDetail\.stakedWithRewards'\)/g)).toHaveLength(2);
        expect(contracts).not.toContain('>My Contracts<');
        expect(dispensers).not.toContain('>My Dispensers<');
        expect(stake).not.toContain('secondaryLabel="Staked + rewards"');
    });

    it('builds the My dispensers action label in the active locale', async () => {
        registerLocale('pseudo-rtl', pseudoRtl);
        await setLocale('pseudo-rtl');
        const definition = ACTION_ENTRY_DEFS.find((entry) => entry.id === 'dispensers-list');
        const entries = buildActionEntries({ [definition.handler]: () => {} });

        expect(definition.labelKey).toBe('actionsMenu.myDispensers');
        expect(entries[0].label).toContain('⟦My dispensers⟧');
    });
});
