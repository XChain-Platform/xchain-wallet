// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the Windows installer's NSIS hooks (packages/desktop/build/
// installer.nsh) are included, hold the behaviour v0.343.1 depends on, and
// still sit where app-builder-lib inserts them.
//
// WHAT THIS IS DEFENDING. Three Windows faults found on v0.343.0:
//
//   - Shortcuts written with a 318-character description had corrupted
//     icon locations, and an update does not rewrite existing shortcuts
//     (KeepShortcuts), so fixing the description alone would leave every
//     existing user's icons blank. customInstall rewrites them.
//   - An arm64 all-users install went to Program Files (x86), because
//     multiUser.nsh picks $PROGRAMFILES64 only under APP_64.
//     customUnInstallCheck moves a fresh one still aimed at the default
//     folder to Program Files; a /D= or other chosen folder stays put.
//   - Uninstall left HKCU\Software\Classes\xchain pointing at a deleted exe.
//     customUnInstall removes the handlers this install registered: a
//     scheme key whose open command starts with the install folder, and
//     never a key with no command.
//
// Plus the Publisher column (package.json author) the uninstall entry reads.
//
// Coverage:
//
//   1. nsis.include names build/installer.nsh and the file exists.
//   2. Each macro is defined once, and its key statements are present.
//   3. The restated handleUninstallResult body still matches the template.
//   4. When app-builder-lib is installed, its templates still insert each
//      macro at the point installer.nsh's comments rely on.
//   5. packages/desktop/package.json author.name is the publisher.

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const require = createRequire(import.meta.url);
const config = require(join(desktop, 'electron-builder.config.cjs'));
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

// --- 1. Included, by name -------------------------------------------------

assert.equal(config.nsis?.include, 'build/installer.nsh',
    'nsis.include names build/installer.nsh (a named include that is missing fails the build)');
const nshPath = join(desktop, 'build', 'installer.nsh');
assert.ok(existsSync(nshPath), 'packages/desktop/build/installer.nsh exists');
const nsh = readFileSync(nshPath, 'utf8');
const code = nsh.split('\n').filter((l) => !/^\s*;/.test(l)).join('\n');

// --- 2. The macros and what they must do ------------------------------

function macroBody(name) {
    const re = new RegExp(`^!macro ${name}\\b[^\\n]*\\n([\\s\\S]*?)^!macroend`, 'gm');
    const found = [...code.matchAll(re)];
    assert.equal(found.length, 1, `installer.nsh defines !macro ${name} exactly once`);
    return found[0][1];
}

const opens = (code.match(/^!macro\b/gm) ?? []).length;
const closes = (code.match(/^!macroend\b/gm) ?? []).length;
assert.equal(opens, closes, 'every !macro has its !macroend');
for (const [open, close] of [[/\$\{if(?:Not)?\}/g, /\$\{endIf\}/gi]]) {
    assert.equal((code.match(open) ?? []).length, (code.match(close) ?? []).length,
        'every ${if}/${ifNot} has its ${endIf}');
}

const install = macroBody('customInstall');
for (const link of ['$newStartMenuLink', '$newDesktopLink']) {
    assert.ok(install.includes(`\${FileExists} "${link}"`),
        `customInstall rewrites ${link} only when it already exists`);
    assert.ok(install.includes(
        `CreateShortCut "${link}" "$appExe" "" "$appExe" 0 "" "" "\${APP_DESCRIPTION}"`),
    `customInstall rewrites ${link} with the template's own arguments (the exe as its icon)`);
    assert.ok(install.includes(`WinShell::SetLnkAUMI "${link}" "\${APP_ID}"`),
        `customInstall stamps the AppUserModelID on ${link}`);
}
assert.match(install, /SHChangeNotify\(i 0x8000000, i 0, i 0, i 0\)/,
    'customInstall tells Explorer to drop its cached icons');

const check = macroBody('customUnInstallCheck');
assert.match(check, /!ifdef APP_ARM64[\s\S]*!ifndef APP_64/,
    'the Program Files move is compiled into the arm64-only installer alone');
// A folder the user chose is never moved: the template copies /D= into
// $INSTDIR, so a /D= naming the x86 default would otherwise look like it.
assert.match(check, /!insertmacro GetDParameter \$xcInstallDirArg[\s\S]*\$\{andIf\} \$xcInstallDirArg == ""/,
    'the Program Files move reads /D= and is skipped whenever one was given');
assert.ok(!/\$R0\b/.test(check.slice(0, check.indexOf('${IsNativeARM64}'))),
    'the move leaves $R0 (the old uninstaller\'s exit code) alone');
for (const cond of [
    '$installMode == "all"',
    '$xcInstallDirArg == ""',
    '$perMachineInstallationFolder == ""',
    '$INSTDIR == "$PROGRAMFILES\\${APP_FILENAME}"',
    '${IsNativeARM64}',
]) {
    assert.ok(check.includes(cond), `the Program Files move requires ${cond}`);
}
assert.ok(check.includes('StrCpy $INSTDIR "$PROGRAMFILES64\\${APP_FILENAME}"'),
    'a fresh arm64 all-users install goes to $PROGRAMFILES64');
assert.ok(check.includes('StrCpy $appExe "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"'),
    '$appExe follows the moved folder (the shortcuts and registry read it)');
assert.ok(check.indexOf('IfErrors') < check.indexOf('${IsNativeARM64}'),
    'the error flag is captured before anything that could change it');

const uninstall = macroBody('customUnInstall');
assert.match(uninstall, /^\s*\$\{ifNot\} \$\{isUpdated\}/m,
    'customUnInstall leaves the handlers alone on an update or reinstall (--updated)');
for (const scheme of ['xchain', 'bitcoin', 'litecoin', 'dogecoin']) {
    assert.ok(uninstall.includes(`!insertmacro xcRemoveOwnUrlHandler "${scheme}"`),
        `customUnInstall considers the ${scheme}: handler`);
}
const handler = macroBody('xcRemoveOwnUrlHandler');
assert.ok(handler.includes('ReadRegStr $R2 HKCU "$R1\\shell\\open\\command" ""'),
    'the handler check reads the open command under HKCU\\Software\\Classes');
assert.match(handler,
    /\$\{if\} \$R2 != ""\s*[\s\S]*?\$\{if\} \$R3 == "\$\\"\$INSTDIR\\"\s*DeleteRegKey HKCU "\$R1"/,
    'a scheme key goes only when it has an open command that starts with this install folder');
// A key with no command is never touched. Parallels Shared Applications
// fills a VM with command-less scheme keys (bitcoin among them) holding
// URL Protocol and SharedHostApplication; an earlier draft deleted those.
assert.equal((handler.match(/DeleteRegKey/g) ?? []).length, 1,
    'the handler has exactly one delete, the one behind the install-folder match');
assert.ok(!/\$\{else\}/.test(handler),
    'the handler has no branch for a key without a command');
for (const probe of ['EnumRegKey', 'EnumRegValue', 'SharedHostApplication', 'URL Protocol']) {
    assert.ok(!handler.includes(probe),
        `the handler does not judge a command-less key by its contents (${probe})`);
}
assert.ok(!/DeleteRegKey\s+HKLM/.test(code), 'installer.nsh never deletes under HKLM');

// --- 5. The publisher ----------------------------------------------------

assert.equal(pkg.author?.name, 'Dankest, LLC',
    'packages/desktop/package.json author.name is the Windows Publisher and CompanyName');

// --- 3/4. The template still matches --------------------------------------

let libDir = null;
try {
    const requireFromDesktop = createRequire(join(desktop, 'package.json'));
    const builderPkg = requireFromDesktop.resolve('electron-builder/package.json');
    libDir = dirname(createRequire(builderPkg).resolve('app-builder-lib/package.json'));
} catch {
    libDir = null;
}

const tpl = libDir ? join(libDir, 'templates', 'nsis') : null;
if (tpl && existsSync(join(tpl, 'installSection.nsh'))) {
    const read = (...p) => readFileSync(join(tpl, ...p), 'utf8');
    const section = read('installSection.nsh');
    const at = (s) => {
        const i = section.indexOf(s);
        assert.ok(i >= 0, `installSection.nsh still contains: ${s}`);
        return i;
    };
    assert.ok(at('!insertmacro addStartMenuLink') < at('!insertmacro customInstall')
        && at('!insertmacro addDesktopLink') < at('!insertmacro customInstall'),
    'customInstall still runs after the template creates or keeps the shortcuts');
    assert.ok(at('!insertmacro handleUninstallResult SHELL_CONTEXT') < at('SetOutPath $INSTDIR')
        && at('SetOutPath $INSTDIR') < at('!insertmacro installApplicationFiles'),
    'handleUninstallResult (customUnInstallCheck) still runs before the files are copied');

    const util = read('include', 'installUtil.nsh');
    assert.match(util,
        /"\$rootKey_uninstallResult" == "SHELL_CONTEXT"\s*!ifmacrodef customUnInstallCheck\s*!insertmacro customUnInstallCheck\s*Return/,
        'handleUninstallResult still hands SHELL_CONTEXT to customUnInstallCheck');
    // The body installer.nsh restates, statement for statement.
    for (const line of [
        'DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`',
        '${if} $R0 != 0',
        'MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"',
        'DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`',
        'SetErrorLevel 2',
    ]) {
        assert.ok(util.includes(line), `the template's handleUninstallResult still says: ${line}`);
        assert.ok(check.includes(line), `customUnInstallCheck restates: ${line}`);
    }
    assert.match(util, /StrCpy \$0 "\$0 --updated"/,
        'uninstallOldVersion still passes --updated to the old uninstaller');

    const multi = read('multiUser.nsh');
    const installerNsi = read('installer.nsi');
    assert.match(multi, /StrCpy \$0 "\$PROGRAMFILES"\s*!ifdef APP_64\s*\$\{if\} \$\{RunningX64\}\s*StrCpy \$0 "\$PROGRAMFILES64"/,
        'multiUser.nsh still picks $PROGRAMFILES64 under APP_64 only (if upstream fixed arm64, '
        + 'customUnInstallCheck\'s move can go)');
    assert.match(multi, /ReadRegStr \$perMachineInstallationFolder HKLM "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/,
        'setInstallModePerAllUsers still reads the stored per-machine location into $perMachineInstallationFolder');
    assert.match(multi, /^!macro GetDParameter outVar\b[\s\S]*?Push \$R5[\s\S]*?StrCpy \$\{outVar\} \$R9\s*Pop \$R5[\s\S]*?!macroend/m,
        'multiUser.nsh still defines GetDParameter, saving the registers it uses');
    assert.match(multi, /!insertmacro GetDParameter \$R0\s*\$\{If\} \$R0 != ""\s*StrCpy \$INSTDIR \$R0/,
        'the template still copies a /D= path into $INSTDIR (why customUnInstallCheck reads it)');
    assert.ok(installerNsi.indexOf('!include "multiUser.nsh"') < installerNsi.indexOf('!include "installUtil.nsh"'),
        'GetDParameter is defined before installUtil.nsh expands customUnInstallCheck');

    const uninst = read('uninstaller.nsh');
    assert.ok(uninst.indexOf('!insertmacro customUnInstall') > uninst.indexOf('!insertmacro setLinkVars'),
        'uninstaller.nsh still inserts customUnInstall');
    const common = read('common.nsh');
    assert.match(common, /StrCpy \$newDesktopLink "\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"/,
        'setLinkVars still names the desktop shortcut $newDesktopLink');
    console.log(`OK: desktop-nsis-hooks smoke (template hook points checked in ${libDir})`);
} else {
    console.log('OK: desktop-nsis-hooks smoke (app-builder-lib not installed, template hook points not checked)');
}
