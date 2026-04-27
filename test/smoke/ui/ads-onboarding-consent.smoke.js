// Smoke for §36.1 — ADS onboarding consent screen during wallet creation.
//
// Source-level: CreateWallet.jsx grows an `ads-consent` stage between
// 'persisting' and `onCreated()`. The stage renders Enable +
// Decline buttons, both equally prominent (no dark pattern), wired
// through `messaging.updateSettings({ ads: { enabled } })`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const createPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'CreateWallet.jsx');

const src = readFileSync(createPath, 'utf8');

// Stage type widened — must still include the ads-consent member.
// The full union grew further (verify quiz at v0.176.0 / G033) so we match
// the ads-consent member specifically rather than pinning the entire shape.
assert.match(
    src,
    /'ads-consent'/,
    'stage union grew an ads-consent member',
);

// Persist no longer calls onCreated directly; it advances to ads-consent.
assert.match(
    src,
    /setStage\('ads-consent'\)/,
    'persist transitions to ads-consent stage',
);

// Consent stage renders two equally-prominent buttons.
assert.match(src, /Enable and continue/, 'Enable button copy present');
assert.match(src, /Decline \(I'll consider it later\)/, 'Decline button copy present');

// Both buttons trigger handleAdsChoice with the right argument.
assert.match(src, /handleAdsChoice\(true\)/, 'Enable wires handleAdsChoice(true)');
assert.match(src, /handleAdsChoice\(false\)/, 'Decline wires handleAdsChoice(false)');

// Choice path writes settings and then calls onCreated.
assert.match(
    src,
    /messaging\.updateSettings\(\{\s*ads:\s*\{\s*enabled:\s*Boolean\(enable\)\s*\}\s*\}\)/,
    'choice persists ads.enabled via updateSettings',
);
assert.match(src, /onCreated\(\)/, 'onCreated still fires after the choice');

// Spec §36.1 copy
assert.match(src, /Support XChain/, 'consent header copy');
assert.match(src, /entirely optional/, 'opt-out language present');

console.log('ads-onboarding-consent smoke OK');
