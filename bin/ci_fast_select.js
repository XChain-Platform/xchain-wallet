#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONSENSUS = [
    'src/consensus/',
    'src/coins/',
    'src/protocol/',
    'bin/pins/'
];

const GROUPS = [
    { name: 'unit', pattern: /^test\/unit\/.+\.test\.(?:js|jsx)$/, config: 'test/vitest/unit.config.js' },
    { name: 'integration', pattern: /^test\/integration\/.+\.test\.(?:js|jsx)$/, config: 'test/vitest/integration.config.js' },
    { name: 'security', pattern: /^test\/security\/.+\.security\.test\.(?:js|jsx)$/, config: 'test/vitest/security.config.js' },
    { name: 'fuzz', pattern: /^test\/fuzz\/harness\/.+\.fuzz\.js$/, config: 'test/vitest/fuzz.config.js' },
    { name: 'smoke', pattern: /^test\/smoke\/.+\.smoke\.js$/ }
];

function runGit(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function resolveBase({ env, git }) {
    const candidate = env.PROM_CI_BASE_SHA;
    if (candidate) {
        try {
            git(['cat-file', '-e', `${candidate}^{commit}`]);
            return candidate;
        } catch {}
    }
    try {
        return git(['merge-base', 'HEAD', 'origin/develop']).trim() || null;
    } catch {
        return null;
    }
}

function groupFor(file) {
    return GROUPS.find((group) => group.pattern.test(file));
}

function hasConsensusPrefix(file) {
    return CONSENSUS.some((prefix) => file.startsWith(prefix));
}

function isConsensusPath(file) {
    return file === 'package.json' || hasConsensusPrefix(file)
        || /^test\/[^/]+\/(?:setup|support)\//.test(file)
        || /^test\/[^/]+\/setup\.js$/.test(file)
        || file.startsWith('test/helpers/')
        || file.startsWith('test/fixtures/')
        || file.startsWith('test/vitest/');
}

function resolvedImportMatches(file, changedFile) {
    let source;
    try {
        source = fs.readFileSync(file, 'utf8');
    } catch {
        return false;
    }
    const changed = path.resolve(changedFile);
    const imports = source.matchAll(/(?:require\(\s*|(?:import|export)(?:[\s\S]*?from\s*)?|import\(\s*)['"](\.[^'"]+)['"]/g);
    for (const match of imports) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        if ([resolved, `${resolved}.js`, `${resolved}.jsx`, path.join(resolved, 'index.js')].includes(changed)) return true;
    }
    return false;
}

function indirectConsensusReasons(changedFile, findRequirers) {
    if (!changedFile.startsWith('src/') || !/\.jsx?$/.test(changedFile)) return [];
    const basename = path.basename(changedFile).replace(/\.jsx?$/, '');
    const importers = findRequirers(basename);
    return importers.filter((file) => hasConsensusPrefix(file)
        && resolvedImportMatches(file, changedFile))
        .map((file) => `consensus importer: ${file} imports ${changedFile}`);
}

function sourceTail(sourceFile) {
    if (sourceFile.startsWith('src/')) return sourceFile.slice(4).replace(/\.jsx?$/, '');
    const match = sourceFile.match(/^packages\/[^/]+\/src\/(.+)\.jsx?$/);
    return match?.[1] || null;
}

function sourceMatchesTest(sourceFile, testFile) {
    const tail = sourceTail(sourceFile);
    if (!tail) return false;
    const name = path.posix.basename(tail);
    const sourceDir = path.posix.dirname(tail);
    const testTail = testFile.replace(/^test\/[^/]+\//, '');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (name !== 'index' && new RegExp(`^${escapedName}\\.(?:[^/]+\\.)?test\\.(?:js|jsx)$`)
        .test(path.posix.basename(testFile))) return true;
    if (testTail.split('/').some((part) => part.startsWith(`${name}.`))) return true;
    return path.posix.dirname(testTail) === sourceDir;
}

function addSourceTests(sourceFile, candidates, selected, findRequirers) {
    for (const file of candidates) {
        if (sourceMatchesTest(sourceFile, file)) selected.add(file);
    }
    const moduleTail = sourceFile.replace(/\.jsx?$/, '');
    for (const file of findRequirers(moduleTail)) {
        if (groupFor(file)) selected.add(file);
    }
}

export function selectFastTests(changedFiles, { listTests, findRequirers }) {
    const changed = [...new Set(changedFiles.filter(Boolean))];
    const reasons = [];
    for (const file of changed) {
        if (isConsensusPath(file)) reasons.push(`consensus: ${file}`);
        reasons.push(...indirectConsensusReasons(file, findRequirers));
    }
    if (reasons.length) {
        return { consensus: true, reasons: [...new Set(reasons)].sort(), tests: [] };
    }

    const candidates = listTests().filter((file) => groupFor(file));
    const existing = new Set(candidates);
    const selected = new Set();
    for (const file of changed) {
        if (groupFor(file) && existing.has(file)) selected.add(file);
        else if (file.startsWith('test/')) reasons.push(`deferred: ${file}`);
        if (/^(?:src|packages\/[^/]+\/src)\//.test(file) && /\.jsx?$/.test(file)) {
            addSourceTests(file, candidates, selected, findRequirers);
        }
    }
    const tests = [...selected].filter((file) => existing.has(file)).sort()
        .map((file) => ({ group: groupFor(file).name, file }));
    return { consensus: false, reasons: [...new Set(reasons)].sort(), tests };
}

function listTests() {
    const output = runGit(['ls-files', '--', 'test']);
    return output ? output.split('\n').filter((file) => fs.existsSync(file)) : [];
}

function findRequirers(needle) {
    try {
        const output = runGit(['grep', '-l', '-F', '--', needle, '--', 'src', 'packages', 'test', 'bin']);
        return output ? output.split('\n') : [];
    } catch (error) {
        if (error.status === 1) return [];
        throw error;
    }
}

function buildPlan() {
    const base = resolveBase({ env: process.env, git: runGit });
    if (!base) return { noBase: 'no valid push base or origin/develop merge base' };
    const output = runGit(['diff', '--name-only', `${base}...HEAD`]);
    const changed = output ? output.split('\n') : [];
    return selectFastTests(changed, { listTests, findRequirers });
}

function printPlan(plan) {
    console.log(`consensus ${plan.consensus ? 1 : 0}`);
    for (const reason of plan.reasons) console.log(`reason ${reason}`);
    for (const selectedTest of plan.tests) console.log(`test ${selectedTest.group} ${selectedTest.file}`);
}

function runPlan(plan) {
    if (!plan.tests.length) {
        console.log('ci:fast: no test maps to this push');
        return 0;
    }
    let failed = false;
    for (const group of GROUPS) {
        const files = plan.tests.filter((selectedTest) => selectedTest.group === group.name)
            .map((selectedTest) => selectedTest.file);
        if (!files.length) continue;
        if (group.config) {
            const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', group.config, ...files], {
                stdio: 'inherit',
                env: process.env
            });
            if (result.status !== 0) failed = true;
        } else {
            for (const file of files) {
                const result = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
                if (result.status !== 0) failed = true;
            }
        }
    }
    return failed ? 1 : 0;
}

function main() {
    if (!['--plan', '--run'].includes(process.argv[2])) {
        console.error('usage: node bin/ci_fast_select.js --plan|--run');
        return 2;
    }
    let plan;
    try {
        plan = buildPlan();
    } catch (error) {
        console.error(`selector-error ${error.message}`);
        return 3;
    }
    if (plan.noBase) {
        console.log(`no-base ${plan.noBase}`);
        return 3;
    }
    if (process.argv[2] === '--plan') {
        printPlan(plan);
        return 0;
    }
    return runPlan(plan);
}

// Compare against argv[1]'s realpath as a URL, so a symlinked or spaced checkout still runs the CLI.
function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    process.exitCode = main();
}
