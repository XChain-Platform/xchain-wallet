// Smoke for §19.5 / Cluster H FOLLOWUP 7 — Home "Back up now" routes
// to the Backup section instead of dropping the user at the Settings root.
//
// Pins:
//   - Home tracks a `settingsSubpage` state alongside `settingsOpen`.
//   - The BackupReminderCard's `onAction` sets `settingsSubpage` to
//     'backup' before opening Settings.
//   - The Settings subpage prop is plumbed via `initialSubpageId`
//     (the existing prop already accepted by Settings).
//   - Closing Settings via Home's onBack resets the subpage to null
//     so a later menu→settings opens at the root, not Backup.
//
// Settings.jsx already accepts `initialSubpageId` (existing) — this
// smoke pins that contract so a future rename in Settings doesn't
// silently break the deep-link.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const homeSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
const settingsSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
    'utf8',
);

// ─── 1. Home wiring ─────────────────────────────────────────────────────

assert.match(
    homeSrc,
    /const \[settingsSubpage, setSettingsSubpage\] = useState/,
    'Home tracks settingsSubpage state',
);
assert.match(
    homeSrc,
    /<BackupReminderCard[\s\S]+?onAction=\{\(\) => \{ setSettingsSubpage\('backup'\); setSettingsOpen\(true\); \}\}/,
    'BackupReminderCard.onAction sets subpage to "backup" before opening Settings',
);
assert.match(
    homeSrc,
    /<Settings[\s\S]+?initialSubpageId=\{settingsSubpage\}/,
    'Settings receives initialSubpageId from Home state',
);
assert.match(
    homeSrc,
    /onBack=\{\(\) => \{ setSettingsOpen\(false\); setSettingsSubpage\(null\); \}\}/,
    'Settings.onBack clears the subpage so the next open lands at root',
);

// ─── 2. Settings still accepts initialSubpageId ─────────────────────────

assert.match(
    settingsSrc,
    /initialSubpageId\s*=\s*null,?/,
    'Settings still declares the initialSubpageId prop with a null default',
);
assert.match(
    settingsSrc,
    /useState\(\/\*\* @type \{string \| null\} \*\/ \(initialSubpageId \|\| null\)\)/,
    'Settings seeds subpageId state from initialSubpageId',
);

// ─── 3. The "backup" id matches a real section ──────────────────────────

assert.match(
    settingsSrc,
    /id: 'backup'/,
    'Settings sections include id "backup" — Home\'s deep-link is valid',
);

console.log('home-backup-deeplink smoke OK');
