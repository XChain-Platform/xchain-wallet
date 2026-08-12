// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Settings sub-pages" -> the "custom chains" surface,
// one of the four the 2026-08-03 re-scope found genuinely undriven.
//
// WHAT THIS SURFACE CAN GET WRONG, and why "a row appeared" is not the test.
// Settings has a documented failure MODE, not just a list of defects: D-70
// (theme / reduced motion / hide-small-balances) and D-91 (the
// endpoints editor) are the same bug twice - a control that PERSISTS its value
// while NOTHING APPLIES it. The user changes a setting, the setting survives a
// reload, and the wallet behaves exactly as it did before. Custom chains is the
// same shape and a worse blast radius: `addCustomChain` must validate, persist
// AND register into the live ChainRegistry, and `removeCustomChain` must
// un-register as well as delete. A spec that only reads the row it just wrote
// back off the same list would pass against a wallet that registers nothing.
//
// So the claim here is REGISTRATION, read somewhere else entirely: the
// "Regtest networks" block on this same page is built from
// `chainRegistry.supportedChains()`, not from the custom-chain settings list,
// so a descriptor that reaches it has genuinely entered the registry the rest
// of the wallet resolves chains through. Checked after a full RELOAD, which is
// also the only way to prove the boot path re-seeds it: a registry entry that
// exists only in the tab that created it is not a chain the wallet has.
//
// THE DESCRIPTOR IS DELIBERATELY NOT A COPY OF A BUNDLED ONE. `xcfork` is not a
// known family, so it takes the validator's unconstrained path (no SLIP-44 slot
// pin, no WIF-byte pin) - which is the path a real third-party fork descriptor
// takes. Copying bitcoin-regtest would have tested the reserved-id branch
// instead and collided with a chain the registry already has.
//
// WHAT IT PINS, EXACTLY, because the reload makes the boundary easy to misread:
// the registry claim is checked AFTER a reload, so what it guards is persistence
// plus the BOOT re-seed (`seedCustomChainsFromVault`), not the registration
// `addCustomChain` performs in the live tab. Both were falsified: bypassing the
// validator reds the refusal claim, disabling the boot seed reds the registry
// claim, and skipping the settings write in `removeCustomChain` reds the
// un-register claim. Measured green in 43.2s on the Litecoin venue 2026-08-03.
//
// RUN IT:
//   cd test/e2e && npx playwright test \
//       --config=playwright.regtest.config.js tests/settings/custom-chains.regtest.spec.js

import { createWallet, expect, openSettings, test } from '../../fixtures/wallet.js';
import { unlockAfterReload } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

const CHAIN_ID = 'xcforke2e-regtest';
const CHAIN_NAME = 'XCFork E2E';

/**
 * A valid, minimal, third-party ChainDescriptor.
 *
 * Every field here is one the validator actually enforces; the shape is the
 * point, so it is written out rather than derived from a bundled descriptor.
 * `http://localhost` endpoints pass only because `networkKind` is regtest -
 * the validator refuses plaintext endpoints anywhere else, which is a rule
 * worth keeping intact rather than working around.
 */
const DESCRIPTOR = {
    id: CHAIN_ID,
    coin: 'xcforke2e',
    displayName: CHAIN_NAME,
    networkKind: 'regtest',
    color: '#8a5cf6',
    icon: '',
    derivationPaths: { p2pkh: "m/44'/1'/A'/C/I" },
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    feeStrategy: {
        unit: 'sats-per-vbyte',
        supportedStrategies: ['normal'],
        defaultStrategy: 'normal',
        rbfSupported: false,
    },
    supportedActions: ['SEND'],
    uriScheme: 'xcforke2e',
    wifVersionByte: 239,
    explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
    encoder: { defaultUrl: 'http://localhost', defaultPort: 3023 },
    hub: { defaultUrl: 'http://localhost', defaultPort: 10000 },
    adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET',
};

/** Opens Settings and walks into the Developer Mode page, with the toggle on. */
async function openDeveloperMode(page) {
    await openSettings(page);
    await page.getByRole('button', { name: /^Developer Mode/ }).click();
    const devToggle = page.getByRole('switch', { name: 'Developer Mode', exact: true });
    await expect(devToggle).toBeVisible({ timeout: 30_000 });
    if (!(await devToggle.isChecked())) {
        // `.check()` cannot be used: the input is controlled by PERSISTED
        // settings, so `checked` does not flip until the vault write resolves
        // and check()'s post-click assertion is synchronous. Same reason
        // `switchToRegtest` clicks and waits.
        await devToggle.click();
        await expect(devToggle).toBeChecked();
    }
}

/** The Regtest-networks entry for `id`, which is REGISTRY-derived. */
function registryEntry(page, id) {
    return page.getByText(new RegExp(`^${id} · explorer`));
}

test.describe('Settings: custom chains', () => {
    test.setTimeout(600_000);

    test('a pasted descriptor is validated, registered, survives a reload, and un-registers on remove',
        async ({ page }) => {
            await createWallet(page, { password: PASSWORD });
            await openDeveloperMode(page);

            await test.step('it refuses a descriptor that is not valid, naming the field', async () => {
                await page.getByRole('button', { name: 'Add custom chain' }).click();
                const json = page.getByLabel('Custom chain descriptor JSON');
                // Valid JSON, invalid DESCRIPTOR: the two failures are handled
                // by different code and only the second one proves the
                // validator runs at all.
                await json.fill(JSON.stringify({ ...DESCRIPTOR, wifVersionByte: 999 }));
                await page.getByRole('button', { name: 'Add chain' }).click();

                // Anchored on the refusal, not on the word: `wifVersionByte`
                // alone also matches the form's own field-list label AND the
                // textarea still holding the pasted JSON, so a bare text match
                // here is a strict-mode violation rather than an assertion.
                await expect(page.getByText(/invalid descriptor:[^]*wifVersionByte/),
                    'a descriptor with an out-of-range WIF version byte was not refused by name, so '
                    + 'the user cannot tell WHICH field of a 16-field blob is wrong')
                    .toBeVisible({ timeout: 30_000 });
                await expect(registryEntry(page, CHAIN_ID),
                    'a REFUSED descriptor still reached the chain registry')
                    .toHaveCount(0);
            });

            await test.step('a valid descriptor is added and enters the live registry', async () => {
                const json = page.getByLabel('Custom chain descriptor JSON');
                await json.fill(JSON.stringify(DESCRIPTOR));
                await page.getByRole('button', { name: 'Add chain' }).click();

                await expect(page.getByText(`Added "${CHAIN_ID}".`),
                    'the add never reported a result').toBeVisible({ timeout: 30_000 });
                await expect(page.getByRole('button', { name: `Remove custom chain ${CHAIN_ID}` }),
                    'the added chain is not listed in Custom chains').toBeVisible({ timeout: 30_000 });
            });

            await test.step('it is REGISTERED, not merely persisted, and boot re-seeds it', async () => {
                // The reload is the assertion. Before it, a passing read could
                // be served by the component's own state; after it, the only
                // thing that can put this row on screen is a ChainRegistry
                // rebuilt at boot from persisted settings - which is exactly
                // what D-91 turned out NOT to do for endpoints.
                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await openDeveloperMode(page);

                await expect(registryEntry(page, CHAIN_ID),
                    'the custom chain persisted but never entered the ChainRegistry, so nothing in '
                    + 'the wallet can resolve it - the D-91 shape: a setting that saves and applies '
                    + 'nothing')
                    .toBeVisible({ timeout: 30_000 });
            });

            await test.step('remove takes it out of the registry too', async () => {
                await page.getByRole('button', { name: `Remove custom chain ${CHAIN_ID}` }).click();
                await expect(page.getByText(`Removed "${CHAIN_ID}".`),
                    'the remove never reported a result').toBeVisible({ timeout: 30_000 });

                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await openDeveloperMode(page);

                await expect(registryEntry(page, CHAIN_ID),
                    'a removed custom chain is still in the ChainRegistry after a reload, so the '
                    + 'wallet still offers a chain the user deleted')
                    .toHaveCount(0);
                await expect(page.getByRole('button', { name: `Remove custom chain ${CHAIN_ID}` }),
                    'the removed chain is still listed in Custom chains').toHaveCount(0);
            });
        });
});
