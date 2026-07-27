// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 26 (piece 11): FreeWallet migration UI
// (§40.13).
//
// Asserts:
//   1. Onboarding surfaces three entries: Create / Import / "Coming
//      from FreeWallet"; the third routes via onImportFromFreeWallet.
//   2. ImportWallet accepts a `variant="freewallet"` prop that
//      rebrands the title/copy, pre-sets the wallet name to
//      "FreeWallet", and tightens the word-count validator to 12.
//   3. MigrateToBip39.jsx exists, exports a single component, runs
//      through explain → create → submitting → done, reuses
//      IssueTokenForm CSS, and calls messaging.createWallet.
//   4. Home renders the legacy-wallet banner when the active wallet
//      has format === 'counterwallet-legacy' and onMigrateToBip39 is
//      supplied; banner class `.legacyBanner` ships in
//      Home.module.css.
//   5. All three shells: App.jsx imports MigrateToBip39, tracks the
//      'migrate-bip39' sub-route + 'import-freewallet' onboarding
//      step, wires onImportFromFreeWallet on Onboarding, wires
//      onMigrateToBip39 on Home.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- 1. Onboarding 3rd entry ----------------------------------------

const onboarding = readFileSync(join(sharedRoutes, 'Onboarding.jsx'), 'utf8');
assert.ok(/onImportFromFreeWallet/.test(onboarding), 'Onboarding declares onImportFromFreeWallet prop');
assert.ok(/From FreeWallet/.test(onboarding), 'Onboarding renders "From FreeWallet" label');

// --- 2. ImportWallet freewallet variant ------------------------------

const importWallet = readFileSync(join(sharedRoutes, 'ImportWallet.jsx'), 'utf8');
assert.ok(
    /variant:\s*importVariant\s*=\s*['"]default['"]/.test(importWallet),
    'ImportWallet accepts a variant prop defaulting to "default"',
);
assert.ok(
    /isFreeWallet\s*=\s*importVariant\s*===\s*['"]freewallet['"]/.test(importWallet),
    'ImportWallet derives isFreeWallet from variant prop',
);
assert.ok(/Import from FreeWallet/.test(importWallet), 'ImportWallet renders FreeWallet branded title');
assert.ok(/12-word FreeWallet recovery phrase/.test(importWallet), 'ImportWallet renders FreeWallet branded subtitle');
assert.ok(
    /acceptedWordCounts\s*=\s*isFreeWallet\s*\?\s*\[12\]/.test(importWallet),
    'ImportWallet tightens word-count validator to 12 in FreeWallet mode',
);
assert.ok(
    /isFreeWallet\s*\?\s*['"]FreeWallet['"]/.test(importWallet),
    'ImportWallet defaults wallet name to "FreeWallet" in FreeWallet mode',
);

// --- 3. MigrateToBip39 ----------------------------------------------

const migratePath = join(sharedRoutes, 'MigrateToBip39.jsx');
assert.ok(existsSync(migratePath), 'MigrateToBip39.jsx exists');
const migrate = readFileSync(migratePath, 'utf8');
assert.ok(/export function MigrateToBip39\b/.test(migrate), 'MigrateToBip39 is a named export');
assert.equal(
    (migrate.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'MigrateToBip39.jsx only exports the component',
);
assert.ok(/IssueTokenForm\.module\.css/.test(migrate), 'MigrateToBip39 reuses IssueTokenForm CSS');
for (const stage of ['explain', 'create', 'submitting', 'backup', 'done']) {
    assert.ok(migrate.includes(`'${stage}'`), `MigrateToBip39 tracks stage "${stage}"`);
}
// This wizard runs on a device that ALREADY holds the legacy wallet, so the
// fresh-install `wallet.create` handler refuses it outright ("a wallet
// already exists"). It must persist through the add path instead .
assert.ok(
    !/messaging\.createWallet\s*\(/.test(migrate),
    'MigrateToBip39 does NOT call the fresh-install messaging.createWallet',
);
assert.ok(
    /messaging\.addImportedWallet\s*\(/.test(migrate),
    'MigrateToBip39 persists via messaging.addImportedWallet (add path)',
);
// It generates the phrase itself, and must SHOW it: the next screen tells the
// user to sweep real balances into this wallet, and the phrase is the only
// way to restore it.
assert.ok(
    /generateBip39Mnemonic\s*\(/.test(migrate),
    'MigrateToBip39 generates the new BIP39 phrase',
);
assert.ok(
    /MnemonicGrid/.test(migrate),
    'MigrateToBip39 displays the new recovery phrase before the sweep step',
);
assert.ok(
    /wroteItDown/.test(migrate),
    'MigrateToBip39 gates the sweep step on a written-down confirmation',
);
assert.ok(/messaging\.getAddressesByChain\s*\(/.test(migrate), 'MigrateToBip39 fetches addresses for the side-by-side preview');
assert.ok(/Legacy FreeWallet format|Counterwallet/.test(migrate), 'MigrateToBip39 references the legacy format in copy');

// --- 4. Home legacy banner ------------------------------------------

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/onMigrateToBip39/.test(home), 'Home.jsx accepts onMigrateToBip39 prop');
assert.ok(
    /activeWallet\?\.format\s*===\s*['"]counterwallet-legacy['"]/.test(home),
    'Home.jsx gates the legacy banner on active wallet format',
);
assert.ok(/legacy-format/.test(home), 'Home.jsx registers the legacy-format alert entry');

const homeCss = readFileSync(join(sharedRoutes, 'Home.module.css'), 'utf8');
assert.ok(/\.legacyBanner\b/.test(homeCss), 'Home.module.css defines .legacyBanner');

// --- 5. Three-shell App.jsx wiring ----------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('MigrateToBip39'), `${shell} App.jsx imports MigrateToBip39`);
    assert.ok(
        app.includes("'import-freewallet'"),
        `${shell} App.jsx tracks the import-freewallet onboarding step`,
    );
    assert.ok(
        app.includes("'migrate-bip39'"),
        `${shell} App.jsx tracks the migrate-bip39 sub-route`,
    );
    assert.ok(
        /variant=['"]freewallet['"]/.test(app),
        `${shell} App.jsx renders ImportWallet with variant="freewallet"`,
    );
    assert.ok(
        /onImportFromFreeWallet=\{\s*\(\)\s*=>\s*setOnboardingStep\(['"]import-freewallet['"]\)\s*\}/.test(app),
        `${shell} App.jsx wires Onboarding.onImportFromFreeWallet`,
    );
    assert.ok(
        /onMigrateToBip39=\{/.test(app),
        `${shell} App.jsx threads onMigrateToBip39 to Home`,
    );
    assert.ok(
        /unlockedView\s*===\s*['"]migrate-bip39['"]/.test(app),
        `${shell} App.jsx renders the migrate-bip39 branch`,
    );
}

console.log(
    'OK: freewallet migration smoke (Onboarding 3rd entry + ImportWallet freewallet variant + MigrateToBip39 4-stage wizard + Home legacy banner + 3-shell App.jsx wiring of onboarding + unlocked sub-route)',
);
