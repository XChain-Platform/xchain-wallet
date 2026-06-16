// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §19.5.2 / G037 — manual on-chain label publish.
//
// Verifies:
//   1. `publishLabelsNow` flow exists, validates inputs, derives the
//      commitment key from the seed, and submits a FILE action via
//      submitAction.
//   2. `wallet.publishLabels` host handler is registered and forwards
//      to the flow.
//   3. Both shells (popup + web) export `publishLabelsRequest`.
//   4. `BackupSection.jsx` replaces the placeholder "Coming soon" row
//      with a four-stage publish form + result panel that wires
//      through `messaging.publishLabelsRequest`.
//   5. `claude/reports/xchain-wallet/FOLLOWUPS.md` exists and tracks
//      the auto-sync + restore-fetch deferred work.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const xchainRoot = join(wsRoot, '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. Flow shape -------------------------------------------------------

const flow = readFileSync(join(core, 'src', 'flows', 'labelSync.js'), 'utf8');
assert.ok(
    /export async function publishLabelsNow\b/.test(flow),
    'publishLabelsNow is a named export of flows/labelSync.js',
);
assert.ok(
    /export class NoFundedAddressError/.test(flow),
    'flow exports NoFundedAddressError for callers that need to disambiguate',
);
assert.ok(
    /export class WifOnlyLabelSyncUnsupportedError/.test(flow),
    'flow exports WifOnlyLabelSyncUnsupportedError so wif-only wallets get a typed error',
);
assert.ok(
    /buildLabelSyncPayload\s*\(/.test(flow)
        && /submitAction\s*\(/.test(flow),
    'publishLabelsNow chains buildLabelSyncPayload + submitAction',
);
assert.ok(
    /action:\s*'FILE'/.test(flow),
    "publishLabelsNow submits a FILE action",
);
assert.ok(
    /rawData:\s*bytesToHex\(ciphertext\)/.test(flow),
    'publishLabelsNow places the ciphertext on encoderOpts.rawData as hex',
);
assert.ok(
    /seed\.fill\(0\)/.test(flow),
    'publishLabelsNow zeroes the derived seed buffer in a finally',
);
assert.ok(
    /plaintext\.fill\(0\)/.test(flow),
    'publishLabelsNow zeroes the decrypted mnemonic plaintext in a finally',
);

const flowsIndex = readFileSync(join(core, 'src', 'flows', 'index.js'), 'utf8');
assert.ok(
    /publishLabelsNow/.test(flowsIndex),
    'flows/index.js re-exports publishLabelsNow',
);

// --- 2. Host handler -----------------------------------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('wallet\.publishLabels'/.test(bg),
    'background host registers wallet.publishLabels',
);
assert.ok(
    /publishLabelsNow\s*\(\s*\{[^}]*walletId:\s*req\?\.walletId/.test(bg),
    'wallet.publishLabels handler forwards walletId',
);
assert.ok(
    /chainId:\s*req\?\.chainId/.test(bg),
    'wallet.publishLabels handler forwards chainId',
);

// --- 3. Messaging surface ------------------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function publishLabelsRequest\b/.test(m),
        `${shell} messaging.js exports publishLabelsRequest`,
    );
    assert.ok(
        /sendMessage\('wallet\.publishLabels'/.test(m),
        `${shell} messaging.js routes via wallet.publishLabels`,
    );
}

// --- 4. BackupSection wiring ---------------------------------------------

const bs = readFileSync(
    join(core, 'src', 'shared', 'components', 'settings', 'BackupSection.jsx'),
    'utf8',
);
assert.ok(
    /publishStage/.test(bs),
    'BackupSection tracks publishStage state',
);
for (const stage of ['idle', 'form', 'running', 'result']) {
    assert.ok(
        bs.includes(`'${stage}'`),
        `BackupSection's publish flow tracks stage "${stage}"`,
    );
}
assert.ok(
    /messaging\.publishLabelsRequest/.test(bs),
    'BackupSection dispatches messaging.publishLabelsRequest',
);
assert.ok(
    /<PublishLabelsForm\b/.test(bs)
        && /<PublishLabelsReport\b/.test(bs),
    'BackupSection renders both PublishLabelsForm + PublishLabelsReport',
);
assert.ok(
    /Publish labels on-chain/.test(bs),
    'BackupSection BackupRow uses the new "Publish labels on-chain" copy (was: Coming soon placeholder)',
);
assert.ok(
    !/Coming soon — opt into §19\.5\.2/.test(bs),
    'BackupSection no longer carries the "Coming soon" placeholder copy',
);
assert.ok(
    /encoder.*FILE/i.test(bs) || /FILE action/.test(bs),
    'BackupSection mentions the FILE-action publish path in user-facing copy',
);
assert.ok(
    /Encrypted size/.test(bs)
        && /Discovery name/.test(bs)
        && /Txid/.test(bs),
    'PublishLabelsReport surfaces txid + size + discovery name',
);

// --- 5. FOLLOWUPS.md exists with the auto-sync + restore-fetch entries --

const followups = join(
    xchainRoot, 'claude', 'reports', 'xchain-wallet', 'FOLLOWUPS.md',
);
assert.ok(existsSync(followups), 'claude/reports/xchain-wallet/FOLLOWUPS.md exists');
const fSrc = readFileSync(followups, 'utf8');
assert.ok(
    /§17\/§19 Sign \/ Verify \/ Backup — closed at v0\.154\.0/.test(fSrc),
    'FOLLOWUPS.md has the §17/§19 Cluster B closing header at v0.154.0',
);
assert.ok(
    /On-change debounced auto-sync/.test(fSrc),
    'FOLLOWUPS.md tracks the auto-sync FOLLOWUP',
);
assert.ok(
    /Fetch \+ decrypt \+ apply on restore/.test(fSrc),
    'FOLLOWUPS.md tracks the restore-fetch FOLLOWUP',
);
