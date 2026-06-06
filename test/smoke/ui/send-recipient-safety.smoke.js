// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive — Step 2 — Send.jsx wires lookalike +
// paste-integrity + AddressText highlight in review.

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

// --- imports ------------------------------------------------------------

assert.match(
    sendSrc,
    /import \{ findLookalike \} from '\.\.\/utils\/lookalike\.js'/,
    'imports findLookalike',
);
assert.match(
    sendSrc,
    /import \{ checkPasteIntegrity \} from '\.\.\/utils\/pasteIntegrity\.js'/,
    'imports checkPasteIntegrity',
);

// --- paste-integrity wiring --------------------------------------------

assert.match(sendSrc, /pasteWarning/, 'pasteWarning state present');
assert.match(
    sendSrc,
    /checkPasteIntegrity\(\{[\s\S]*pastedText:\s*text\s*\}\)/,
    'paste handler runs the integrity check on the pasted text',
);
assert.match(
    sendSrc,
    /if \(!res\.ok\) setPasteWarning/,
    'mismatch surfaces a warning',
);

// --- lookalike wiring --------------------------------------------------

assert.match(
    sendSrc,
    /findLookalike\(\{[\s\S]*address:\s*trimmed[\s\S]*candidates:\s*suggestions/,
    'lookalike runs against autocomplete candidates',
);
assert.match(sendSrc, /lookalikeWarning/, 'lookalikeWarning memo present');
assert.match(
    sendSrc,
    /Looks .* similar to/i,
    'warning copy mentions similarity',
);

// --- warnings rendered under To-field ----------------------------------

const formIdx = sendSrc.indexOf('<AddressCombobox');
assert.notEqual(formIdx, -1);
const formBlock = sendSrc.slice(formIdx, formIdx + 2000);
assert.match(formBlock, /pasteWarning \?/, 'pasteWarning rendered in form');
assert.match(formBlock, /lookalikeWarning \?/, 'lookalikeWarning rendered in form');
assert.match(formBlock, /role="alert"/, 'warnings carry alert role');

// --- review-stage AddressText highlight --------------------------------

const reviewIdx = sendSrc.indexOf("stage === 'review'");
assert.notEqual(reviewIdx, -1);
const reviewBlock = sendSrc.slice(reviewIdx);
assert.match(
    reviewBlock,
    /<AddressText address=\{fromAddress\.address\} highlight \/>/,
    'From row gets checksum highlighting',
);
assert.match(
    reviewBlock,
    /d\.label === 'Destination'/,
    'destination detail rendered through AddressText',
);
assert.match(
    reviewBlock,
    /<AddressText address=\{d\.value\} highlight \/>/,
    'destination renders with highlight',
);

console.log('send-recipient-safety smoke OK');
