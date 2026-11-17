// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §35 Settings, Step 3: About panel.
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

for (const [label, message] of [
    ['Version', 'settings.about.version'],
    ['Update channel', 'settings.about.updateChannel'],
    ['License', 'settings.about.license'],
    ['Notice', 'settings.about.notice'],
    ['Reproducible build', 'settings.about.reproducibleBuild'],
    ['Release signatures', 'settings.about.releaseSignatures'],
    ['Disclosure policy', 'settings.about.disclosurePolicy'],
]) {
    assert.ok(
        // Titled Sections: facts are Fact rows (label) and links are action rows (title).
        aboutSrc.includes(`label={t('${message}')}`) || aboutSrc.includes(`label="${label}"`)
            || aboutSrc.includes(`title={t('${message}')}`) || aboutSrc.includes(`title="${label}"`),
        `AboutSection renders a row labelled "${label}"`,
    );
}
assert.match(
    aboutSrc,
    /title=(?:\{t\('settings\.about\.license'\)\}|"License")[\s\S]*?docLinkProps\(LICENSE_FILE\)/,
    'the License row links to the license file',
);

assert.match(
    aboutSrc,
    /title=\{t\('settings\.about\.releaseSignatures'\)\}[\s\S]*?docLinkProps\(RELEASE_SIGNATURES_DOC\)/,
    'release signatures opens the external resource',
);
assert.match(
    aboutSrc,
    /title=\{t\('settings\.about\.disclosurePolicy'\)\}[\s\S]*?docLinkProps\(SECURITY_FILE\)/,
    'disclosure policy opens the repository document',
);
assert.doesNotMatch(aboutSrc, /AboutLicensePage|AboutUnpublishedPage|onOpenLicense/, 'About has no document child pages');

// ─── 4. Settings.jsx wires AboutSection as the `about` panel ────────

const settingsSrc = readFileSync(settingsPath, 'utf8');
assert.match(
    settingsSrc,
    /import \{ AboutSection \} from '\.\.\/components\/settings\/AboutSection\.jsx'/,
    'Settings.jsx imports AboutSection',
);
assert.doesNotMatch(
    settingsSrc,
    /about-license|about-release-signatures|about-disclosure-policy/,
    'Settings has no About document child routes',
);

// The about section block should now declare `kind: 'panel'` and
// `Component: AboutSection`, NOT 'stub'.
const aboutBlockIdx = settingsSrc.indexOf("id: 'about'");
assert.ok(aboutBlockIdx >= 0, 'about section literal present');
const aboutBlock = settingsSrc.slice(aboutBlockIdx, aboutBlockIdx + 600);
assert.match(aboutBlock, /kind:\s*'internal-drill'/, 'about section kind is panel (not stub)');
assert.match(aboutBlock, /Component:\s*AboutSection/, 'about section wires AboutSection');

// Render switch handles the `panel` kind.
assert.match(
    settingsSrc,
    /section\.kind === 'panel'/,
    'Settings.jsx render switch handles panel kind',
);

console.log('settings-about smoke OK');
