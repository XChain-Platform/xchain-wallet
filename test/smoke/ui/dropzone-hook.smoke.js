// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §37 / G123 useDropZone hook + the three integrations
// shipped at v0.209.0 (PsbtSignForm, ContactsSection, ImportWallet
// backup lane). Static-text checks pin the public hook surface and
// the wiring so a future refactor can't silently regress drop support.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const hookSrc = read('packages/core/src/shared/hooks/useDropZone.js');
const psbtSrc = read('packages/core/src/shared/routes/PsbtSignForm.jsx');
const contactsSrc = read('packages/core/src/shared/components/settings/ContactsSection.jsx');
const importSrc = read('packages/core/src/shared/routes/ImportWallet.jsx');

// 1. The hook is exported and accepts the documented option keys.
assert.ok(/export function useDropZone\(/.test(hookSrc),
    'useDropZone exports the hook');
for (const opt of ['onFile', 'accept', 'maxBytes', 'readAs', 'onError', 'disabled']) {
    assert.ok(new RegExp(`\\b${opt}\\b`).test(hookSrc), `useDropZone references option "${opt}"`);
}

// 2. The hook returns the documented public surface.
for (const ret of ['rootProps', 'isDragOver', 'openFilePicker', 'pickerProps']) {
    assert.ok(new RegExp(`\\b${ret}\\b`).test(hookSrc), `useDropZone returns "${ret}"`);
}

// 3. Drop handlers preventDefault + clear the drag-over indicator,
//    and the picker resets after each pick so the same file fires
//    onChange again.
assert.ok(/event\.preventDefault\(\)/.test(hookSrc),
    'useDropZone calls event.preventDefault on dragOver / drop');
assert.ok(/setIsDragOver\(false\)/.test(hookSrc),
    'useDropZone clears the dragOver flag on leave / drop');
assert.ok(/inputRef\.current\.value = ''/.test(hookSrc),
    'useDropZone resets the hidden file input after each pick');

// 4. File-size and accept-type validation gates run before onFile.
assert.ok(/file\.size > maxBytes/.test(hookSrc),
    'useDropZone enforces a maxBytes limit');
assert.ok(/matchesAccept\(file, accept\)/.test(hookSrc),
    'useDropZone enforces the accept allowlist');

// 5. PsbtSignForm wires the hook for binary .psbt drop with an
//    arrayBuffer read mode + the standard choose-file field, whose dialog
//    opens on .psbt files while the hook itself takes any file.
assert.ok(/from '\.\.\/hooks\/useDropZone\.js'/.test(psbtSrc),
    'PsbtSignForm imports useDropZone');
assert.ok(/readAs:\s*'arrayBuffer'/.test(psbtSrc),
    'PsbtSignForm reads dropped PSBTs as ArrayBuffer');
assert.ok(/arrayBufferToHex\(/.test(psbtSrc),
    'PsbtSignForm converts the ArrayBuffer to hex before re-using normalizePsbtInput');
assert.ok(/<FileField[\s\S]*?accept=\{psbtDialogAccept\(\)\}[\s\S]*?drop=\{drop\}[\s\S]*?chooseLabel="Choose a transaction file"/.test(psbtSrc)
        && !/useDropZone\(\{[^}]*\baccept:/.test(psbtSrc),
    'PsbtSignForm opens the file dialog from its choose-file field');

// 6. ContactsSection takes JSON and CSV on the Import row through the shared
//    file field, which owns its own picker input and drop target.
assert.ok(/from '\.\.\/FileField\.jsx'/.test(contactsSrc),
    'ContactsSection imports the shared FileField');
assert.ok(/CONTACT_IMPORT_ACCEPT = \['application\/json', 'text\/csv', '\.json', '\.csv'\]/.test(contactsSrc),
    'ContactsSection restricts the file field to JSON and CSV files');
assert.ok(/isContactsImportFile\(file\)/.test(contactsSrc),
    'ContactsSection refuses a dropped file that names another type');
assert.ok(/importFromText\(/.test(contactsSrc),
    'ContactsSection routes a chosen or dropped file through the same import-from-text path');
assert.ok(/onFile=\{onImportFile\}/.test(contactsSrc),
    'ContactsSection hands the field one handler for the picker and the drop');

// 7. ImportWallet backup lane wires the hook for .xchain-wallet drop.
assert.ok(/from '\.\.\/hooks\/useDropZone\.js'/.test(importSrc),
    'ImportWallet imports useDropZone');
assert.ok(/'\.xchain-wallet'/.test(importSrc),
    'ImportWallet backupDrop accepts the .xchain-wallet extension');
assert.ok(/setBackupFileName\(file\.name\);[\s\S]{0,200}setBackupContent/.test(importSrc),
    'ImportWallet backupDrop seeds the existing backupContent / backupFileName state');
assert.ok(/drop a backup file/i.test(importSrc),
    'ImportWallet hint surfaces the drop affordance');

console.log('OK: useDropZone + PsbtSignForm / ContactsSection / ImportWallet wiring smoke (24 checks)');
