// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Security: .npmrc hygiene (, review-store #2232)
 *
 * The repo .npmrc is committed, so whatever lands in it reaches every clone and
 * every CI runner. Two accidents are cheap to make and invisible in review:
 *
 *   1. A registry auth token. npm and pnpm write tokens to the nearest .npmrc,
 *      so a stray `npm login` run from this directory commits a credential.
 *   2. A TLS or integrity downgrade. `strict-ssl=false` reached the sibling
 *      explorer repo exactly that way, as a one-line drive-by inside an
 *      unrelated feature commit, and sat there turning off certificate
 *      verification for every dependency install until this item.
 *
 * Nobody reads a dotfile in a large diff. This suite reads it instead.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve off this file, not cwd: the suite must find the repo .npmrc no matter
// which directory vitest was invoked from.
const here       = dirname(fileURLToPath(import.meta.url));
const NPMRC_PATH = join(here, '..', '..', '.npmrc');

// npm/pnpm credential keys. Registry-scoped forms prefix them with a bare
// registry URL (`//registry.npmjs.org/:_authToken=...`), hence the leading
// separator alternation.
const CREDENTIAL_KEY_PATTERN = /(^|[:/])_?(auth|authToken|password|username|secret|apikey|api_key|token)\s*=/i;

// Env-var interpolation is the correct way for a committed .npmrc to reference
// a secret, so it must not read as a leak.
const ENV_INTERPOLATION_ONLY = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/** Directive lines only. npm accepts both `#` and `;` as comment markers. */
function directiveLines(raw) {
    return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith(';'));
}

function splitDirective(line) {
    const eq = line.indexOf('=');
    if (eq === -1) return { key: line.trim(), value: '' };
    return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
}

/** Credential keys present in raw .npmrc text. Values are never returned. */
function findCredentialKeys(raw) {
    return directiveLines(raw)
        .map(splitDirective)
        .filter(({ key, value }) => CREDENTIAL_KEY_PATTERN.test(`${key}=`) && !ENV_INTERPOLATION_ONLY.test(value))
        .map(({ key }) => key);
}

/** strict-ssl value in raw .npmrc text, or null when undeclared. */
function strictSslValue(raw) {
    const hit = directiveLines(raw)
        .map(splitDirective)
        .find(({ key }) => key.toLowerCase() === 'strict-ssl');
    return hit ? hit.value.toLowerCase() : null;
}

// A guard that cannot fail is not a guard. These fixtures pin the detectors to
// the shapes that motivated the item, so a later refactor cannot quietly
// neuter the file checks below.
describe('.npmrc hygiene detectors', () => {
    it('flags a bare auth token', () => {
        expect(findCredentialKeys('_authToken=npm_examplevalue\n')).toEqual(['_authToken']);
    });

    it('flags a registry-scoped auth token', () => {
        const keys = findCredentialKeys('//registry.npmjs.org/:_authToken=npm_examplevalue\n');
        expect(keys).toHaveLength(1);
        expect(keys[0]).toContain('_authToken');
    });

    it('flags legacy basic-auth credentials', () => {
        expect(findCredentialKeys('_auth=Zm9vOmJhcg==\n')).toEqual(['_auth']);
        expect(findCredentialKeys('_password=Zm9vOmJhcg==\n')).toEqual(['_password']);
    });

    it('accepts an env-var reference, which leaks nothing', () => {
        expect(findCredentialKeys('//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n')).toEqual([]);
    });

    it('ignores credential-shaped words inside comments', () => {
        expect(findCredentialKeys('# never put _authToken=... in this file\nstrict-ssl=true\n')).toEqual([]);
        expect(findCredentialKeys('; _password=... belongs in ~/.npmrc\nstrict-ssl=true\n')).toEqual([]);
    });

    it('detects the TLS downgrade that motivated this suite', () => {
        expect(strictSslValue('strict-ssl=false\n')).toBe('false');
        expect(strictSslValue('strict-ssl=true\n')).toBe('true');
        expect(strictSslValue('shamefully-hoist=true\n')).toBeNull();
    });
});

describe('committed .npmrc', () => {
    const raw = existsSync(NPMRC_PATH) ? readFileSync(NPMRC_PATH, 'utf8') : null;

    it('exists at the repo root', () => {
        expect(raw, `.npmrc missing at ${NPMRC_PATH}`).not.toBeNull();
    });

    it('carries no registry credential', () => {
        // Offending keys only. Echoing a value would move the leak from the
        // file into the CI log.
        const offenders = findCredentialKeys(raw ?? '');
        expect(offenders, `credential-bearing keys in .npmrc: ${offenders.join(', ')}`).toEqual([]);
    });

    it('does not disable TLS certificate verification', () => {
        expect(strictSslValue(raw ?? ''), 'strict-ssl must be pinned true in the committed .npmrc').toBe('true');
    });

    it('does not disable integrity or signature checking', () => {
        // Sibling downgrades that defeat the lockfile's supply-chain guarantees
        // the way strict-ssl=false defeats transport security.
        const forbiddenFalse = ['audit-signatures', 'verify-store-integrity'];
        const forbiddenTrue  = ['unsafe-perm'];

        for (const { key, value } of directiveLines(raw ?? '').map(splitDirective)) {
            const k = key.toLowerCase();
            const v = value.toLowerCase();
            if (forbiddenFalse.includes(k)) expect(v, `${k} must not be disabled`).not.toBe('false');
            if (forbiddenTrue.includes(k))  expect(v, `${k} must not be enabled`).not.toBe('true');
        }
    });

    it('does not point installs at an unencrypted registry', () => {
        const registryUrls = directiveLines(raw ?? '')
            .map(splitDirective)
            .filter(({ key }) => key.toLowerCase() === 'registry' || key.toLowerCase().endsWith(':registry'))
            .map(({ value }) => value);

        for (const url of registryUrls) {
            expect(url, `registry ${url} is not https`).toMatch(/^https:\/\//i);
        }
    });
});
