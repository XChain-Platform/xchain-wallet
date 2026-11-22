// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path) {
    return readFileSync(join(process.cwd(), path), 'utf8');
}

const bridgeEventsSource = source('packages/extension/src/bridge/bridgeEvents.js');
const connectedSitesSource = source(
    'packages/core/src/shared/components/settings/ConnectedSitesSection.jsx',
);
const commonLocaleSource = source('packages/core/src/i18n/locales/en/common.js');
const settingsLocaleSource = source('packages/core/src/i18n/locales/en/settings.js');

describe('provider permission semantics', () => {
    it('reserves chainChanged for active network changes', () => {
        expect(bridgeEventsSource).toContain('export async function notifyNetworkChanged');
        expect(bridgeEventsSource).not.toMatch(/addedChains[\s\S]*events\.chainChanged/);
    });

    it('labels empty grants with their wildcard meaning', () => {
        expect(connectedSitesSource).toContain("t('common.allNetworks')");
        expect(connectedSitesSource).toContain("t('settings.connectedSites.allAccounts')");
        expect(commonLocaleSource).toContain("'common.allNetworks': 'All networks'");
        expect(settingsLocaleSource).toContain(
            "'settings.connectedSites.allAccounts': 'All accounts, including ones you add later'",
        );
    });
});
