// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const wsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');

const productionSurfaces = [
    ['packages', 'core', 'src', 'flows', 'index.js'],
    ['packages', 'core', 'src', 'shared', 'hooks', 'useConfirmAction.js'],
    ['packages', 'core', 'src', 'shared', 'hooks', 'useActionConfirmFlow.js'],
    ['packages', 'core', 'src', 'shared', 'routeRegistry.js'],
    ['packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'],
    ['packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'],
    ['packages', 'core', 'src', 'shared', 'routes', 'AirdropForm.jsx'],
    ['packages', 'extension', 'src', 'background', 'createBackgroundHost.js'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
];

const retired = /ResumeConfirm|confirmResume|ConfirmSession|confirmSession|onResumeConfirm|resume-confirm/;
for (const path of productionSurfaces) {
    assert.doesNotMatch(read(...path), retired, `${path.join('/')} must not wire resume confirmation`);
}

const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /reservationStoreFrom\(actionSafetyStorage\)/,
    'reservation persistence must survive independently of confirm sessions');
assert.match(host, /ownSpendStoreFrom\(actionSafetyStorage\)/,
    'own-spend persistence must survive independently of confirm sessions');

console.log('OK: resume confirmation is absent from production routes, shells, messaging and host wiring');
