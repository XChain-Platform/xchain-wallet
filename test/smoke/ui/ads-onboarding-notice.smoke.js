// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §36.1: the Automatic Donation System notice at the end of
// onboarding.
//
// Source-level. The notice is one shared component, AdsNotice.jsx, and
// every route that finishes onboarding ends on it: CreateWallet.jsx has an
// `ads-notice` stage between 'persisting' and `onCreated()`, and
// ImportWallet.jsx shows it after a mnemonic import, the FreeWallet
// migration variant (same route, `variant="freewallet"`), a backup restore
// and a backup-pointer restore, in both 'fresh' and 'add' modes. The notice
// informs and does not ask (operator ruling 2026-10-12, modelled on
// FreeWallet desktop): one Continue button, no decline button, no
// per-chain amounts, and no settings write, because ADS_DEFAULT_ENABLED
// already holds and every preference lives in Settings -> Automatic
// Donation System.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const shared = join(wsRoot, 'packages', 'core', 'src', 'shared');
const read = (...p) => readFileSync(join(shared, ...p), 'utf8');

const notice = read('components', 'AdsNotice.jsx');
const create = read('routes', 'CreateWallet.jsx');
const imp = read('routes', 'ImportWallet.jsx');

// --- The component: one button, and it only continues ----------------

const buttons = notice.match(/<Button\b/g) || [];
assert.equal(buttons.length, 1, 'the notice renders exactly one button');
assert.match(notice, /onClick=\{onContinue\}/, 'Continue calls onContinue');
assert.match(notice, /t\('adsNotice\.continue'\)/, 'the button reads localized Continue copy');
assert.equal(en['adsNotice.continue'], 'Continue', 'the English button copy stays Continue');

// No way to decline here, and no choice handler left behind.
for (const [name, src] of [['notice', notice], ['create', create], ['import', imp]]) {
    assert.doesNotMatch(src, /Decline/, `no decline button in the ${name} flow`);
    assert.doesNotMatch(src, /Enable and continue/, `no enable/decline pairing in the ${name} flow`);
    assert.doesNotMatch(src, /handleAdsChoice/, `no choice handler in the ${name} flow`);
    assert.doesNotMatch(
        src,
        /updateSettings\(\{\s*ads:/,
        `the ${name} flow writes no ads setting; the default already holds`,
    );
}

// It is a notice: names the system, says it is on by default, says
// donating is not required, and points at Settings for every preference.
assert.equal(en['adsNotice.title'], 'Automatic Donation System', 'names the system');
assert.match(en['adsNotice.defaultBehavior'], /on by default/, 'says ADS is on by default');
assert.match(en['adsNotice.optional'], /don't need to donate/, 'says donating is not required');
assert.match(en['adsNotice.settings'], /Settings → Automatic Donation System/, 'points at the settings section');
assert.match(en['adsNotice.settings'], /turned off entirely/, 'says where it can be turned off');

// No amounts on this screen: release defaults are shown and tuned in
// Settings (§36.6), so a retune never leaves stale numbers here.
const noticeCopy = Object.entries(en)
    .filter(([key]) => key.startsWith('adsNotice.'))
    .map(([, value]) => value)
    .join(' ');
assert.doesNotMatch(noticeCopy, /\bsats\b|\bLTC\b|\bDOGE\b|[0-9],[0-9]{3}/, 'no per-chain amounts on the notice');

// --- Create: persist advances to the notice, not to onCreated --------

assert.match(create, /'ads-notice'/, 'create stage union has an ads-notice member');
assert.match(create, /setStage\('ads-notice'\)/, 'create persist transitions to the ads-notice stage');
const createStart = create.indexOf("if (stage === 'ads-notice')");
assert.ok(createStart > 0, 'located the create ads-notice render branch');
assert.match(
    create.slice(createStart, create.indexOf('</Screen>', createStart)),
    /<AdsNotice[\s\S]*onContinue=\{onCreated\}/,
    'create Continue goes straight to onCreated',
);

// --- Import: every success path ends on the notice -------------------

// The notice Continue marks itself consumed before it calls onImported. A
// completed background label restore may call it again only after that mark,
// so late labels refresh Home without skipping the notice.
const importedCalls = imp.match(/\bonImported\b/g) || [];
assert.equal(
    importedCalls.length,
    4,
    'onImported appears only in the prop contract, the guarded label refresh and notice Continue',
);
assert.match(
    imp,
    /if \(labelSync\?\.restored && adsContinuedRef\.current\) onImported\(\)/,
    'a late label restore refreshes Home only after Continue',
);
const importStart = imp.indexOf('if (adsNotice)');
assert.ok(importStart > 0, 'located the import ads-notice render branch');
assert.match(
    imp.slice(importStart, imp.indexOf('</Screen>', importStart)),
    /<AdsNotice[\s\S]*onContinue=\{continueAfterNotice\}/,
    'import Continue uses the guarded completion handler',
);
assert.match(
    imp,
    /const continueAfterNotice = \(\) => \{\s*adsContinuedRef\.current = true;\s*onImported\(\);/,
    'import Continue marks the notice consumed before refreshing App',
);

// Mnemonic import (which also carries the FreeWallet variant), fresh
// backup restore, and the add-mode backup restore and pointer restore:
// each success path flips the flag after its messaging call returns.
const flips = imp.match(/setAdsNotice\(true\)/g) || [];
assert.equal(flips.length, 3, 'three import success paths raise the notice');
assert.match(
    imp,
    /messaging\.importBackupFresh\([\s\S]*?\);\s*setAdsNotice\(true\)/,
    'a fresh-install restore ends on the notice',
);
assert.match(
    imp,
    /mode,\s*\}\);\s*\}\s*setAdsNotice\(true\)/,
    'the add-mode restore and pointer restore end on the notice',
);
assert.match(
    imp,
    /messaging\.importMnemonic\([^)]*\);\s*\}[\s\S]*?setAdsNotice\(true\)/,
    'a mnemonic import (FreeWallet variant included) ends on the notice',
);

console.log('ads-onboarding-notice smoke OK');
