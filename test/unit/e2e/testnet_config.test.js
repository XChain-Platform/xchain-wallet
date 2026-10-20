// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import config from '../../e2e/playwright.testnet.config.js';
import { suiteOrigin, suitePort } from '../../e2e/fixtures/testnet_origin.js';

const E2E_DIR = fileURLToPath(new URL('../../e2e/', import.meta.url));
const TESTNET_CONFIG_URL = new URL('../../e2e/playwright.testnet.config.js', import.meta.url);

function jsonReportPath(loadedConfig) {
    const jsonReporter = loadedConfig.reporter.find(([name]) => name === 'json');
    expect(jsonReporter).toBeDefined();
    return path.resolve(E2E_DIR, jsonReporter[1].outputFile);
}

function evidenceDefaultReportPath() {
    const evidenceUrl = new URL('../../e2e/fixtures/testnet_evidence.js', import.meta.url);
    const source = fs.readFileSync(evidenceUrl, 'utf8');
    const match = source.match(
        /const DEFAULT_REPORT = path\.resolve\(HERE,\s*['"](\.\.)['"],\s*['"](test-results-testnet)['"],\s*['"](results\.json)['"]\);/,
    );

    expect(match).not.toBeNull();
    return path.resolve(path.dirname(fileURLToPath(evidenceUrl)), ...match.slice(1));
}

describe('Playwright testnet config', () => {
    it('pins serial execution, the suite origin, and a fresh strict preview', () => {
        const globalSetup = path.resolve(E2E_DIR, config.globalSetup);
        const launchArgs = [
            config.use?.launchOptions?.args,
            ...config.projects.map((project) => project.use?.launchOptions?.args),
        ].flatMap((args) => args ?? []);

        expect(config.workers).toBe(1);
        expect(config.retries).toBe(0);
        expect(config.fullyParallel).toBe(false);
        expect(config.testMatch).toBe('**/*.testnet.spec.js');
        expect(globalSetup).toBe(path.resolve(E2E_DIR, 'global-setup.testnet.js'));
        expect(fs.existsSync(globalSetup)).toBe(true);
        expect(config.use.baseURL).toBe(suiteOrigin());
        expect(config.webServer.url).toBe(`http://localhost:${suitePort()}`);
        expect(config.webServer.reuseExistingServer).toBe(false);
        expect(config.webServer.command).toMatch(/^node fixtures\/testnet_origin\.js &&/);
        expect(config.webServer.command).toContain('--strictPort');
        expect(launchArgs.some((arg) => String(arg).includes('disable-web-security'))).toBe(false);
    });

    it('keeps non-CI and CI JSON reports aligned with testnet_evidence.js', async () => {
        try {
            vi.stubEnv('CI', '');
            vi.resetModules();
            const nonCiConfig = (await import(TESTNET_CONFIG_URL.href)).default;

            vi.stubEnv('CI', '1');
            vi.resetModules();
            const ciConfig = (await import(TESTNET_CONFIG_URL.href)).default;

            const expected = path.resolve(E2E_DIR, 'test-results-testnet', 'results.json');
            expect(jsonReportPath(nonCiConfig)).toBe(expected);
            expect(jsonReportPath(ciConfig)).toBe(expected);
            expect(evidenceDefaultReportPath()).toBe(expected);
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
});
