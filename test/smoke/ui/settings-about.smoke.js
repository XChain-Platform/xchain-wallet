// Smoke for §35 Settings — Step 3 — About panel.
//
// Source-level checks: AboutSection.jsx pulls from buildInfo.js,
// renders the spec §35.1 About rows (version, license, repro-build,
// release signatures, disclosure policy), and Settings.jsx wires it
// in as the `about` section's Component. Build constants are
// version-synchronized.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const corePkgPath = join(wsRoot, 'packages', 'core', 'package.json');
const buildInfoPath = join(wsRoot, 'packages', 'core', 'src', 'buildInfo.js');
const aboutPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'AboutSection.jsx');
const settingsPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx');

// ─── 1. buildInfo.js exports the expected constants ─────────────────

const buildInfoSrc = readFileSync(buildInfoPath, 'utf8');
for (const name of [
    'WALLET_VERSION',
    'LICENSE_NAME',
    'LICENSE_FILE',
    'NOTICE_FILE',
    'SECURITY_FILE',
    'SECURITY_PUBLISHED',
    'REPRODUCIBLE_BUILD_DOC',
    'RELEASE_SIGNATURES_DOC',
    'RELEASE_SIGNATURES_PUBLISHED',
    'UPDATE_CHANNEL',
]) {
    assert.match(
        buildInfoSrc,
        new RegExp(`export const ${name}\\b`),
        `buildInfo.js exports ${name}`,
    );
}

// ─── 2. WALLET_VERSION matches the workspace's published version ────

const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf8'));
const versionMatch = /export const WALLET_VERSION = '([^']+)';/.exec(buildInfoSrc);
assert.ok(versionMatch, 'WALLET_VERSION literal extractable from buildInfo.js');
assert.equal(
    versionMatch[1],
    corePkg.version,
    `buildInfo.WALLET_VERSION (${versionMatch[1]}) must equal core package version (${corePkg.version})`,
);

// ─── 3. AboutSection imports + renders the right surface ────────────

const aboutSrc = readFileSync(aboutPath, 'utf8');
assert.match(
    aboutSrc,
    /import \{[\s\S]*WALLET_VERSION[\s\S]*\} from ['"]\.\.\/\.\.\/\.\.\/buildInfo\.js['"]/,
    'AboutSection imports from buildInfo.js',
);
assert.match(aboutSrc, /export function AboutSection\(/, 'AboutSection is a named export');

for (const label of [
    'Version',
    'Update channel',
    'License',
    'Notice',
    'Reproducible build',
    'Release signatures',
    'Disclosure policy',
]) {
    assert.ok(
        aboutSrc.includes(`label="${label}"`),
        `AboutSection renders a row labelled "${label}"`,
    );
}

// Items whose underlying artifact isn't published render a muted
// fallback rather than an inert link. Two such items exist: release
// signatures and disclosure policy.
assert.match(aboutSrc, /not yet published/, 'AboutSection has unpublished-fallback copy');
assert.match(aboutSrc, /SECURITY_PUBLISHED \?/, 'disclosure policy gates on SECURITY_PUBLISHED');
assert.match(
    aboutSrc,
    /RELEASE_SIGNATURES_PUBLISHED \?/,
    'release signatures gates on RELEASE_SIGNATURES_PUBLISHED',
);

// ─── 4. Settings.jsx wires AboutSection as the `about` panel ────────

const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(
    settingsSrc,
    /import \{ AboutSection \} from '\.\.\/components\/settings\/AboutSection\.jsx'/,
    'Settings.jsx imports AboutSection',
);

// The about section block should now declare `kind: 'panel'` and
// `Component: AboutSection`, NOT 'stub'.
const aboutBlockIdx = settingsSrc.indexOf("id: 'about'");
assert.ok(aboutBlockIdx >= 0, 'about section literal present');
const aboutBlock = settingsSrc.slice(aboutBlockIdx, aboutBlockIdx + 600);
assert.match(aboutBlock, /kind:\s*'panel'/, 'about section kind is panel (not stub)');
assert.match(aboutBlock, /Component:\s*AboutSection/, 'about section wires AboutSection');

// Render switch handles the `panel` kind.
assert.match(
    settingsSrc,
    /section\.kind === 'panel'/,
    'Settings.jsx render switch handles panel kind',
);

console.log('settings-about smoke OK');
