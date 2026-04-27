// Smoke for Cluster B Step 4 — G038 — dry-run restore UI.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'BackupSection.jsx'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const webMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const popupMessagingSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);

// --- BackupSection wiring ---------------------------------------------

assert.match(sectionSrc, /messaging\.dryRunRestoreRequest/, 'calls dryRunRestoreRequest');
assert.match(sectionSrc, /dryRunStage/, 'tracks dry-run stage');
assert.match(sectionSrc, /'idle' \| 'form' \| 'running' \| 'result'/, 'four dry-run stages');
assert.match(sectionSrc, /<DryRunForm/, 'inline form component');
assert.match(sectionSrc, /<DryRunReport/, 'comparison report component');
assert.match(sectionSrc, /Run test/, 'submit copy');
assert.match(
    sectionSrc,
    /Backup matches this wallet/,
    'overall-match success copy',
);
assert.match(
    sectionSrc,
    /Backup does NOT match/,
    'overall-match failure copy',
);
assert.match(sectionSrc, /matchedCount/, 'shows matched counts');
assert.match(sectionSrc, /divergentCount/, 'shows divergent counts');
assert.match(sectionSrc, /missingCount/, 'shows missing counts');

// Format selector covers both kinds.
assert.match(sectionSrc, /value="bip39"/, 'BIP39 option');
assert.match(sectionSrc, /value="counterwallet-legacy"/, 'Counterwallet option');

// Counterwallet branch hides BIP39 passphrase input.
assert.match(
    sectionSrc,
    /format === 'bip39' \?[\s\S]{0,100}BIP39 passphrase/,
    'passphrase input is gated behind format === bip39',
);

// --- host handler -----------------------------------------------------

assert.match(hostSrc, /dryRunRestore\b/, 'host destructures dryRunRestore from flows');
assert.match(
    hostSrc,
    /host\.register\('wallet\.dryRunRestore'/,
    'host registers wallet.dryRunRestore',
);

// --- messaging wrappers -----------------------------------------------

for (const [src, name] of [
    [webMessagingSrc, 'web'],
    [popupMessagingSrc, 'popup'],
]) {
    assert.match(
        src,
        /export function dryRunRestoreRequest/,
        `${name} messaging exports dryRunRestoreRequest`,
    );
    assert.match(
        src,
        /sendMessage\('wallet\.dryRunRestore'/,
        `${name} messaging dispatches wallet.dryRunRestore`,
    );
}

console.log('dry-run-restore-ui smoke OK');
