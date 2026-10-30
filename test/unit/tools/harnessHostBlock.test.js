// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every test browser stays off the live services. A Playwright route handler
// misses WebSockets and service-worker requests, so the host-resolver switch
// is the guard that holds by any transport. This walks every Playwright
// config and every place a harness launches a browser itself:
//
//   - a dev-mock or demo harness carries HOST_BLOCK_ARG (only loopback
//     resolves);
//   - a harness that drives a regtest venue carries a rule that maps the
//     production service hosts away;
//   - the testnet config reaches the public testnet by design and keeps its
//     per-request outbound guard;
//   - the desktop app launches through guardedLaunchOptions, whose network
//     guard refuses every non-loopback host in the main process and the
//     renderer;
//   - WebKit takes no Chromium switches, so its venues are left as they are.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    HOST_BLOCK_ARG,
    PRODUCTION_BLOCK_ARG,
    withHostBlock,
} from '../../e2e/host-block.js';
import { guardedLaunchOptions } from '../../e2e/fixtures/electron.js';
import { GUARD_ENV, GUARD_SWITCH } from '../../../packages/desktop/main/networkGuard.js';

const repoRoot = resolve(__dirname, '../../..');
const e2eDir = join(repoRoot, 'test/e2e');

const tracked = (...paths) => execFileSync('git', ['ls-files', '--', ...paths], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean);

/** Configs that drive a regtest venue: production hosts mapped away. */
const VENUE_CONFIGS = new Set([
    'playwright.regtest.config.js',
    'playwright.ratelimit.config.js',
    'playwright.extension.config.js',
]);

/** Configs that reach a public network by design, with the guard that holds instead. */
const OPEN_CONFIGS = {
    'playwright.testnet.config.js': 'fixtures/outboundGuard.js',
};

/** Launch files that drive a regtest venue. */
const VENUE_LAUNCHES = new Set([
    'test/e2e/fixtures/extension.js',
    'test/e2e/fixtures/extension-isolated.js',
    'test/e2e/fixtures/gasToken.js',
    'test/e2e/fixtures/qrCamera.js',
]);

const PRODUCTION_HOSTS = ['explorer.xchain.io', 'hub.xchain.io', 'encoder.xchain.io'];

/** The host-resolver rules in a list of Chromium switches, as one string each. */
const resolverRules = (args = []) => args
    .filter((arg) => typeof arg === 'string' && arg.startsWith('--host-resolver-rules='))
    .map((arg) => arg.slice('--host-resolver-rules='.length));

/** True when the rules make every production service host fail to resolve. */
function blocksProduction(rules) {
    return rules.some((rule) => {
        const maps = rule.split(',').map((part) => part.trim());
        const blocked = (host) => maps.includes(`MAP ${host} ~NOTFOUND`)
            || maps.includes('MAP *.xchain.io ~NOTFOUND')
            || maps.includes('MAP * ~NOTFOUND');
        return PRODUCTION_HOSTS.every(blocked);
    });
}

/** The source of the call that opens at `open` (an index just past the name), parens balanced. */
function callSource(src, open) {
    let depth = 0;
    let quote = null;
    for (let i = open; i < src.length; i += 1) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i += 1;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') quote = c;
        else if (c === '(') depth += 1;
        else if (c === ')') {
            depth -= 1;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    return src.slice(open);
}

const LAUNCH = /\b(?:chromium|webkit|firefox|electron|_electron)\.(?:launch|launchPersistentContext|launchServer)\s*(?=\()/g;

/** Every browser launch in one source file, with the call text. */
function launchCalls(src) {
    const calls = [];
    for (const match of src.matchAll(LAUNCH)) {
        calls.push({ name: match[0], line: src.slice(0, match.index).split('\n').length, call: callSource(src, match.index + match[0].length) });
    }
    return calls;
}

/** The rule a launch call carries: 'offline', 'production', 'electron-guard' or null. */
function launchGuard(call) {
    if (/\bHOST_BLOCK_ARG\b/.test(call) || call.includes(HOST_BLOCK_ARG)) return 'offline';
    if (/\bPRODUCTION_BLOCK_ARG\b/.test(call) || blocksProduction(resolverRules([...call.matchAll(/'(--host-resolver-rules=[^']*)'/g)].map((m) => m[1])))) {
        return 'production';
    }
    if (/^\s*\(\s*guardedLaunchOptions\(/.test(call)) return 'electron-guard';
    return null;
}

async function loadConfig(file) {
    // Every venue the configs know, not only the default ones.
    process.env.LAYOUT_VENUES = 'all';
    process.env.CRAWL_VENUES = 'all';
    process.env.XC_RATE_LIMIT_AT6 = '1';
    const mod = await import(pathToFileURL(join(e2eDir, file)).href);
    return mod.default;
}

describe('harness host-resolver block', () => {
    const configs = tracked('test/e2e/playwright.config.js', 'test/e2e/playwright.*.config.js').map((path) => path.slice('test/e2e/'.length));

    it('finds the configs and launch sites it checks', () => {
        expect(configs).toContain('playwright.config.js');
        expect(configs.length).toBeGreaterThan(10);
    });

    it.each(configs)('%s carries the block on every Chromium project', async (file) => {
        const config = await loadConfig(file);
        if (OPEN_CONFIGS[file]) {
            expect(readFileSync(join(e2eDir, file), 'utf8'), `${file} keeps its outbound guard`).toContain(OPEN_CONFIGS[file]);
            return;
        }
        for (const project of config.projects ?? []) {
            const use = { ...(config.use ?? {}), ...(project.use ?? {}) };
            const browser = use.browserName ?? use.defaultBrowserType ?? 'chromium';
            if (browser !== 'chromium') continue;
            const rules = resolverRules(use.launchOptions?.args);
            if (VENUE_CONFIGS.has(file)) {
                expect(blocksProduction(rules), `${file} ${project.name}: production hosts resolve (${rules.join(' | ') || 'no rule'})`).toBe(true);
            } else {
                expect(use.launchOptions?.args ?? [], `${file} ${project.name}: no host-resolver block`).toContain(HOST_BLOCK_ARG);
            }
        }
    });

    const sources = tracked('test/e2e', 'tools').filter((path) => /\.(m?js|jsx)$/.test(path));
    const launches = sources.flatMap((path) => launchCalls(readFileSync(join(repoRoot, path), 'utf8'))
        .map((call) => ({ path, ...call })));

    it('finds every place a harness launches a browser', () => {
        expect(launches.length).toBeGreaterThan(5);
    });

    it.each(launches.map((l) => [`${l.path}:${l.line}`, l]))('%s launches with the block', (_where, { path, name, call }) => {
        const guard = launchGuard(call);
        if (/electron\./.test(name)) {
            expect(guard, `${path}: desktop launch outside guardedLaunchOptions`).toBe('electron-guard');
        } else if (VENUE_LAUNCHES.has(path)) {
            expect(['offline', 'production'], `${path}: venue launch lets the production hosts resolve`).toContain(guard);
        } else {
            expect(guard, `${path}: launch without HOST_BLOCK_ARG`).toBe('offline');
        }
    });

    it('launches the desktop app with its network guard on', () => {
        const options = guardedLaunchOptions({ args: ['main.js'] });
        expect(options.args).toContain(`--${GUARD_SWITCH}`);
        expect(options.env[GUARD_ENV]).toBe('1');
    });

    it('tells the rules apart', () => {
        expect(launchGuard(`({ args: ['--load-extension=x'] })`)).toBeNull();
        expect(launchGuard(`({ args: [HOST_BLOCK_ARG] })`)).toBe('offline');
        expect(launchGuard(`({ args: ['--host-resolver-rules=MAP explorer.xchain.io ~NOTFOUND'] })`)).toBeNull();
        expect(launchGuard(`({ args: ['--host-resolver-rules=MAP explorer.xchain.io ~NOTFOUND, MAP hub.xchain.io ~NOTFOUND, MAP encoder.xchain.io ~NOTFOUND'] })`)).toBe('production');
        expect(blocksProduction(resolverRules([PRODUCTION_BLOCK_ARG]))).toBe(true);
        expect(blocksProduction(resolverRules([HOST_BLOCK_ARG]))).toBe(true);
        expect(withHostBlock({ name: 'w', use: { browserName: 'webkit' } })).toEqual({ name: 'w', use: { browserName: 'webkit' } });
        expect(withHostBlock({ name: 'c', use: { launchOptions: { args: ['--a'] } } }).use.launchOptions.args).toEqual(['--a', HOST_BLOCK_ARG]);
    });
});
