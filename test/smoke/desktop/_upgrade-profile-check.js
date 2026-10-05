// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let exportDir;
let profileDir;

function runStep(step, operation) {
    try {
        return operation();
    } catch (error) {
        throw new Error(`${step}: ${error.message}`);
    }
}

function runCommand(step, command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: 'inherit',
        ...options,
    });
    if (result.error) throw new Error(`${step}: ${result.error.message}`);
    if (result.status !== 0) {
        throw new Error(`${step}: exited with status ${result.status}`);
    }
    return result.stdout?.trim();
}

function readGit(step, args) {
    return runCommand(step, 'git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function resolveVersions() {
    const priorRef = process.env.XCHAIN_UPGRADE_FROM
        || readGit('find prior release', [
            'describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD',
        ]);
    const headSha = readGit('resolve current commit', ['rev-parse', 'HEAD']);
    const priorSha = readGit('resolve prior release', ['rev-parse', `${priorRef}^{commit}`]);
    if (priorSha === headSha) {
        throw new Error(`resolve prior release: ${priorRef} resolves to HEAD`);
    }
    return { priorRef, priorSha, headSha };
}

function exportRelease(priorRef) {
    const archivePath = join(exportDir, 'release.tar');
    runCommand('archive prior release', 'git', [
        'archive', '--format=tar', `--output=${archivePath}`, priorRef,
    ]);
    runCommand('extract prior release', 'tar', ['-xf', archivePath, '-C', exportDir]);
    runStep('remove prior release archive', () => rmSync(archivePath, { force: true }));
    runStep('copy current profile seeder', () => copyFileSync(
        join(root, 'test/smoke/desktop/_populated-profile.js'),
        join(exportDir, 'test/smoke/desktop/_populated-profile.js'),
    ));
}

function installRelease() {
    runCommand('install prior release', 'pnpm', [
        'install',
        '--frozen-lockfile',
        '--ignore-scripts',
        '--prefer-offline',
    ], { cwd: exportDir });
}

function seedProfile() {
    runCommand('seed prior release profile', process.execPath, [
        'test/smoke/desktop/_populated-profile.js',
        profileDir,
    ], { cwd: exportDir });
}

function reopenProfile() {
    runCommand('reopen profile with current tree', process.execPath, [
        'test/smoke/desktop/populated-profile.smoke.js',
    ], {
        env: { ...process.env, XCHAIN_PROFILE_DIR: profileDir },
    });
}

function cleanTempDir(step, directory) {
    if (!directory) return;
    try {
        rmSync(directory, { recursive: true, force: true });
    } catch (error) {
        console.error(`upgrade profile check failed: ${step}: ${error.message}`);
        process.exitCode = 1;
    }
}

try {
    exportDir = runStep('create prior release directory', () => (
        mkdtempSync(join(tmpdir(), 'xchain-upgrade-export-'))
    ));
    profileDir = runStep('create profile directory', () => (
        mkdtempSync(join(tmpdir(), 'xchain-upgrade-profile-'))
    ));
    const { priorRef, priorSha, headSha } = resolveVersions();
    exportRelease(priorRef);
    installRelease();
    seedProfile();
    reopenProfile();
    console.log(
        `upgrade profile check: seeded under ${priorRef} (${priorSha.slice(0, 7)}), `
        + `reopened on ${headSha.slice(0, 7)} OK`,
    );
} catch (error) {
    console.error(`upgrade profile check failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    cleanTempDir('remove prior release directory', exportDir);
    cleanTempDir('remove profile directory', profileDir);
}
