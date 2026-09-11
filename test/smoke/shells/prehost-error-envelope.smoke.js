// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ONE ERROR ENVELOPE, INCLUDING ON THE PRE-HOST LANE.
//
// `MessageHost.serializeError` carries `code` and the THROTTLED hints
// (retryAfterMs / burst / windowMs) across the wire, and all three renderer
// transports rebuild them with the shared `hydrateEnvelopeError`. The pre-host
// lane - session.status, wallet.unlock / lock / create / import,
// wallet.importBackup.fresh - does not go through MessageHost, and on the two
// message-passing shells a hand-rolled `{ name, message }` is the regression.
//
// That dropped the one structured field this lane actually raises:
// `UnlockThrottledError` sets `retryAfterMs` and is thrown from
// `handleWalletUnlock`. The web shell runs the unlock in-page and keeps the
// live Error, so the same helper rejected richer on one shell than on the
// other two, against transport headers that promise the fields survive.
//
// A source read, because the producers are not injectable: the extension
// listener builds its own Chrome backends and the desktop envelope is module
// private. What can still be checked here is that neither producer rebuilds
// the envelope by hand, which is the drift itself.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const PRODUCERS = {
    'extension pre-host listener': join(wsRoot, 'packages', 'extension', 'src', 'background', 'sessionMeta.js'),
    'desktop pre-host dispatcher': join(wsRoot, 'packages', 'desktop', 'main', 'runtime.js'),
    'extension runtime adapter': join(wsRoot, 'packages', 'extension', 'src', 'background', 'ChromeRuntimeAdapter.js'),
};

// The hand-rolled shape, in the form all three producers wrote it.
const HAND_ROLLED = /name:\s*\(err && err\.name\)/;

for (const [label, file] of Object.entries(PRODUCERS)) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
        /serializeError/.test(src),
        `${label} (${file}) does not reach for serializeError, so an error it produces reaches the `
        + 'renderer without `code` or the THROTTLED hints the transports promise to preserve',
    );
    assert.ok(
        !HAND_ROLLED.test(src),
        `${label} (${file}) still rebuilds the wire envelope by hand as { name, message }. That drops `
        + 'retryAfterMs off an UnlockThrottledError, which is raised on exactly this lane, and it drops '
        + '`code` off everything else. Call serializeError instead.',
    );
}

// The fields themselves, so the list cannot be trimmed on one side of the wire
// and left standing on the other.
const messageHost = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'MessageHost.js'),
    'utf8',
);
for (const field of ['retryAfterMs', 'burst', 'windowMs']) {
    assert.ok(
        messageHost.includes(field),
        `MessageHost no longer carries ${field}, so the pre-host producers now preserve a field set `
        + 'that no longer exists; update this smoke deliberately rather than by deletion',
    );
}

console.log(`OK: pre-host error envelope smoke (${Object.keys(PRODUCERS).length} producers all serialize `
    + 'through MessageHost.serializeError, none hand-rolls { name, message })');
