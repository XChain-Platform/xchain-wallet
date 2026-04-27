// Smoke for §44 Fee UX — Step 5 — Send.jsx seeds feePick from
// settings.fees[chainId].

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);

// --- imports -----------------------------------------------------------

assert.match(
    sendSrc,
    /settingsCustomToDisplayRate/,
    'imports settingsCustomToDisplayRate',
);

// --- seed effect -------------------------------------------------------

assert.match(sendSrc, /chainFees\.strategy/, 'reads strategy from settings');
assert.match(
    sendSrc,
    /chainFees\.strategy === 'custom'/,
    'custom branch handled',
);
assert.match(
    sendSrc,
    /Number\.isFinite\(chainFees\.customSatsPerKb\)/,
    'guards on finite customSatsPerKb',
);
assert.match(
    sendSrc,
    /settingsCustomToDisplayRate\(tableUnit, chainFees\.customSatsPerKb\)/,
    'converts settings rate to display unit',
);
assert.match(
    sendSrc,
    /\['low', 'normal', 'fast'\]\.includes\(chainFees\.strategy\)/,
    'tier branch only fires for known modes',
);

// --- chain-aware unit lookup ------------------------------------------

assert.match(
    sendSrc,
    /desc\?\.coin === 'dogecoin' \? 'DOGE\/kB' : 'sat\/vB'/,
    'unit derived from descriptor.coin',
);

// --- effect deps -------------------------------------------------------

assert.match(
    sendSrc,
    /\[chainId, settings\]/,
    'effect re-runs when chain or settings change',
);

console.log('send-fee-settings-default smoke OK');
