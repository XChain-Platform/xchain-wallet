// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §36.1: the Automatic Donation System notice during wallet
// creation.
//
// Source-level: CreateWallet.jsx has an `ads-notice` stage between
// 'persisting' and `onCreated()`. It informs and does not ask (operator
// ruling 2026-10-12, modelled on FreeWallet desktop): one Continue button,
// no decline button, no per-chain amounts, and no settings write, because
// ADS_DEFAULT_ENABLED already holds and every preference lives in
// Settings -> Automatic Donation System.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const createPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'CreateWallet.jsx');
const src = readFileSync(createPath, 'utf8');

// The stage exists and persist advances to it rather than calling
// onCreated directly.
assert.match(src, /'ads-notice'/, 'stage union has an ads-notice member');
assert.match(src, /setStage\('ads-notice'\)/, 'persist transitions to the ads-notice stage');

const start = src.indexOf("if (stage === 'ads-notice')");
assert.ok(start > 0, 'located the ads-notice render branch');
const stage = src.slice(start, src.indexOf('<Screen', start));

// One button, and it only continues.
const buttons = stage.match(/<Button\b/g) || [];
assert.equal(buttons.length, 1, 'the notice renders exactly one button');
assert.match(stage, /onClick=\{onCreated\}/, 'Continue goes straight to onCreated');
assert.match(stage, />\s*Continue\s*</, 'the button reads Continue');

// No way to decline here, and no choice handler left behind.
assert.doesNotMatch(src, /Decline/, 'no decline button anywhere in the create flow');
assert.doesNotMatch(src, /Enable and continue/, 'no enable/decline pairing');
assert.doesNotMatch(src, /handleAdsChoice/, 'no choice handler');
assert.doesNotMatch(
    src,
    /updateSettings\(\{\s*ads:/,
    'the notice writes no ads setting; the default already holds',
);

// It is a notice: names the system, says it is on by default, says
// donating is not required, and points at Settings for every preference.
assert.match(stage, /Automatic Donation System/, 'names the system');
assert.match(stage, /on by default/, 'says ADS is on by default');
assert.match(stage, /do not need to donate/, 'says donating is not required');
assert.match(stage, /Settings &rarr; Automatic Donation System/, 'points at the settings section');
assert.match(stage, /turned off entirely/, 'says where it can be turned off');

// No amounts on this screen: release defaults are shown and tuned in
// Settings (§36.6), so a retune never leaves stale numbers here.
assert.doesNotMatch(stage, /\bsats\b|\bLTC\b|\bDOGE\b|[0-9],[0-9]{3}/, 'no per-chain amounts on the notice');

console.log('ads-onboarding-notice smoke OK');
