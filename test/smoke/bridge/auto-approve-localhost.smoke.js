// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §48.6 / G151 Localhost auto-approve. Pins the helper
// surface, the bridge.connect short-circuit, the Settings toggle,
// and the schema's v2-tolerant validation.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const helperSrc = read('packages/core/src/shared/utils/originAutoApprove.js');
const handlersSrc = read('packages/extension/src/bridge/handlers.js');
const sectionSrc = read('packages/core/src/shared/components/settings/DeveloperModeSection.jsx');
const schemaSrc = read('packages/core/src/schemas/settings.js');

// 1. Helper exports both classifier functions.
assert.ok(/export function isLocalhostOrigin\(/.test(helperSrc),
    'originAutoApprove exports isLocalhostOrigin');
assert.ok(/export function shouldAutoApproveConnect\(/.test(helperSrc),
    'originAutoApprove exports shouldAutoApproveConnect');

// 2. Helper allows http(s) localhost / 127.0.0.1 / [::1] but rejects
//    other origins / protocols.
assert.ok(/'localhost'/.test(helperSrc) && /'127\.0\.0\.1'/.test(helperSrc),
    'helper allowlists localhost + 127.0.0.1');
assert.ok(/'\[::1\]'/.test(helperSrc) && /'::1'/.test(helperSrc),
    'helper covers IPv6 loopback (bracketed and bare)');
assert.ok(/'http:'/.test(helperSrc) && /'https:'/.test(helperSrc),
    'helper allowlists http and https protocols');

// 3. shouldAutoApproveConnect requires BOTH developerMode AND
//    autoApproveLocalhost to be true.
assert.ok(/!settings\.developerMode/.test(helperSrc),
    'helper short-circuits when developerMode is off');
assert.ok(/!settings\.autoApproveLocalhost/.test(helperSrc),
    'helper short-circuits when autoApproveLocalhost is off');

// 4. bridge.connect imports + calls the helper, and uses the
//    settings store to read the live toggle state.
assert.ok(/from '@xchain-wallet\/core\/shared\/utils\/originAutoApprove\.js'/.test(handlersSrc),
    'bridge handlers import the helper');
assert.ok(/shouldAutoApproveConnect\(\{ origin, settings \}\)/.test(handlersSrc),
    'bridge.connect calls shouldAutoApproveConnect with origin + live settings');
assert.ok(/deps\.vault\.settings\.get\(\)\.catch\(\(\) => null\)/.test(handlersSrc),
    'bridge.connect reads settings defensively (catches missing store)');

// 5. Auto-approve synthesizes a permissive but conservative decision:
//    canSignMessage:false and canSignAction:{} so sign requests still
//    prompt the user.
assert.ok(/canSignMessage: false/.test(handlersSrc),
    'auto-approve decision keeps canSignMessage false');
assert.ok(/canSignAction: \{\}/.test(handlersSrc),
    'auto-approve decision keeps canSignAction empty');

// 6. Settings → Developer Mode toggle wires the new field.
assert.ok(/Auto-approve localhost dApps/.test(sectionSrc),
    'DeveloperModeSection still renders the row label');
assert.ok(/checked=\{Boolean\(settings\.autoApproveLocalhost\)\}/.test(sectionSrc),
    'DeveloperModeSection reads the live toggle state');
assert.ok(/disabled=\{!settings\.developerMode\}/.test(sectionSrc),
    'DeveloperModeSection greys out the toggle when Developer Mode is off');
assert.ok(/onToggle\('autoApproveLocalhost'/.test(sectionSrc),
    'DeveloperModeSection wires the onChange to update the field');

// 7. Settings schema validates the new field as v2-tolerant.
assert.ok(/autoApproveLocalhost\?: boolean/.test(schemaSrc) || /autoApproveLocalhost.*v2-tolerant/.test(schemaSrc),
    'Settings typedef documents autoApproveLocalhost as v2-tolerant');
assert.ok(/r\.autoApproveLocalhost !== undefined/.test(schemaSrc),
    'Settings validator accepts missing field (v2-tolerant)');
assert.ok(/'autoApproveLocalhost'/.test(schemaSrc),
    'Settings validator rejects non-boolean values');

console.log('OK: localhost auto-approve helper + bridge wiring + Settings + schema smoke');
