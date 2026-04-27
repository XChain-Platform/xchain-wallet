// Smoke for §35 Settings — Step 13 — Backup panel.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sectionPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'BackupSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');
const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const popupMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js');
const webMsgPath = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');

const src = readFileSync(sectionPath, 'utf8');

// useMessaging + exportBackupFile call
assert.match(src, /import \{ useMessaging \}/, 'imports useMessaging');
assert.match(
    src,
    /messaging\.exportBackupFile\(\{[\s\S]+?walletId:\s*activeWallet\.id/,
    'calls messaging.exportBackupFile with walletId',
);

// Password prompt with confirm + mismatch detection
assert.match(src, /Backup password/, 'password prompt label present');
assert.match(src, /Confirm password/, 'confirm-password input present');
assert.match(src, /mismatch =/, 'mismatch detection present');

// Download trigger uses Blob + temporary anchor
assert.match(src, /new Blob\(/, 'Blob constructor used for download');
assert.match(src, /\.xchain-wallet/, 'download filename has .xchain-wallet extension');

// Three deferred rows
for (const label of [
    'Back up seed phrase',
    'Test backup',
    'Published labels',
]) {
    assert.ok(src.includes(label), `${label} row present`);
}

// Host handler + messaging wrappers
const hostSrc = readFileSync(hostPath, 'utf8');
assert.match(hostSrc, /host\.register\('wallet\.exportBackup'/, 'host registers wallet.exportBackup');
assert.match(hostSrc, /exportBackupFile,/, 'host destructures exportBackupFile from flows');

const popupMsg = readFileSync(popupMsgPath, 'utf8');
const webMsg = readFileSync(webMsgPath, 'utf8');
assert.match(popupMsg, /export function exportBackupFile/, 'popup messaging exports exportBackupFile');
assert.match(webMsg, /export function exportBackupFile/, 'web messaging exports exportBackupFile');
assert.match(popupMsg, /sendMessage\('wallet\.exportBackup'/, 'popup wires wallet.exportBackup');
assert.match(webMsg, /sendMessage\('wallet\.exportBackup'/, 'web wires wallet.exportBackup');

// Settings.jsx wires BackupSection with activeWallet prop and the
// render switch passes panel props through.
const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(settingsSrc, /import \{ BackupSection \}/, 'Settings.jsx imports BackupSection');
const idx = settingsSrc.indexOf("id: 'backup'");
const block = settingsSrc.slice(idx, idx + 600);
assert.match(block, /kind:\s*'internal-drill'/);
assert.match(block, /Component:\s*BackupSection/);
assert.match(block, /props:\s*\{\s*activeWallet\s*\}/, 'BackupSection receives activeWallet via section.props');
assert.match(settingsSrc, /<Component \{\.\.\.panelProps\} \/>/, 'render switch spreads panel props');

console.log('settings-backup smoke OK');
