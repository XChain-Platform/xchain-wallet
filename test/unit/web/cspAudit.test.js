// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_TOKEN_ICONS } from '../../../packages/core/src/flows/demoFixtures.js';
import {
    BUILD_PROFILES,
    contentSecurityPolicyFor,
    cspMetaTag,
    metaContentSecurityPolicyFor,
} from '../../../packages/web/src/csp.js';
import { injectIntegrityImportMap } from '../../../packages/web/sri.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const WEB_CONNECT_SOURCES = [
    "'self'",
    'https:',
    'wss:',
    'http://localhost:*',
    'http://127.0.0.1:*',
    'ws://localhost:*',
    'ws://127.0.0.1:*',
];
const LOCAL_IMAGE_SOURCES = ["'self'", 'data:', 'blob:'];
const KEYWORD_SOURCE = /^'(?:self|none|unsafe-inline|unsafe-eval|wasm-unsafe-eval)'$/;
const HASH_SOURCE = /^'(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}'$/;
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/i;
const HOST_SOURCE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:\*\.)?(?:\*|[a-z0-9.-]+)(?::(?:\*|\d+))?(?:\/[^\s]*)?$/i;

function isSourceExpression(source) {
    return [KEYWORD_SOURCE, HASH_SOURCE, NONCE_SOURCE, SCHEME_SOURCE, HOST_SOURCE]
        .some((pattern) => pattern.test(source));
}

function parsePolicy(policy) {
    expect(typeof policy).toBe('string');
    expect(policy.trim()).not.toBe('');

    const directives = {};
    for (const rawDirective of policy.split(';')) {
        const directive = rawDirective.trim();
        if (!directive) continue;
        const [name, ...sources] = directive.split(/\s+/);
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(sources.length, `${name} has no source list`).toBeGreaterThan(0);
        expect(directives, `${name} is duplicated`).not.toHaveProperty(name);
        expect(sources, `${name} has an empty source`).not.toContain('');
        for (const source of sources) {
            expect(isSourceExpression(source), `${name} contains invalid source ${source}`).toBe(true);
        }
        if (sources.includes("'none'")) {
            expect(sources, `${name} combines 'none' with another source`).toEqual(["'none'"]);
        }
        directives[name] = sources;
    }
    return directives;
}

function policyFromMetaTag(tag) {
    const meta = [...tag.matchAll(/<meta\b[^>]*>/gi)]
        .map((match) => match[0])
        .find((candidate) => /\bhttp-equiv="Content-Security-Policy"/i.test(candidate));
    expect(meta, 'document has a CSP meta tag').toBeDefined();
    const content = meta.match(/\bcontent="([^"]*)"/i);
    expect(content, 'CSP meta tag has a content attribute').not.toBeNull();
    return content[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function expectNoExecutableStringSources(directives) {
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
    for (const sources of Object.values(directives)) {
        expect(sources).not.toContain("'unsafe-eval'");
        expect(sources).not.toContain("'wasm-unsafe-eval'");
    }
}

describe('built web CSPs', () => {
    for (const profile of BUILD_PROFILES) {
        it(`parses the ${profile} header and meta policies`, () => {
            const header = parsePolicy(contentSecurityPolicyFor(profile));
            const meta = parsePolicy(metaContentSecurityPolicyFor(profile));

            expect(meta).toEqual(Object.fromEntries(
                Object.entries(header).filter(([name]) => name !== 'frame-ancestors'),
            ));
            expect(header['connect-src']).toEqual(WEB_CONNECT_SOURCES);
            expect(header['img-src']).toEqual(LOCAL_IMAGE_SOURCES);
            expectNoExecutableStringSources(header);
        });

        it(`keeps the ${profile} policy parseable after SRI admits its import map`, () => {
            const result = injectIntegrityImportMap(
                `<html><head>${cspMetaTag(profile)}</head></html>`,
                { '/assets/app.js': 'export const ready = true;' },
            );
            const directives = parsePolicy(policyFromMetaTag(result.html));

            expect(result.admitted).toBe(true);
            expect(directives['script-src'].filter((source) => /^'sha384-/.test(source))).toHaveLength(1);
            expect(directives['connect-src']).toEqual(WEB_CONNECT_SOURCES);
            expectNoExecutableStringSources(directives);
        });
    }
});

describe('packaged shell CSPs', () => {
    it('parses the desktop policy and keeps renderer connections local', () => {
        const html = readFileSync(resolve(REPO, 'packages/desktop/renderer/index.html'), 'utf8');
        const directives = parsePolicy(policyFromMetaTag(html));

        expect(directives['connect-src']).toEqual(["'self'"]);
        expect(directives['img-src']).toEqual(LOCAL_IMAGE_SOURCES);
        expectNoExecutableStringSources(directives);
    });

    it('parses the extension policy and limits it to documented connection classes', () => {
        const manifest = JSON.parse(readFileSync(resolve(REPO, 'packages/extension/manifest.json'), 'utf8'));
        const directives = parsePolicy(manifest.content_security_policy.extension_pages);

        expect(directives['connect-src']).toEqual(WEB_CONNECT_SOURCES);
        expect(directives['img-src']).toEqual(LOCAL_IMAGE_SOURCES);
        expect(directives['object-src']).toEqual(["'none'"]);
        expect(directives['frame-src']).toEqual(["'none'"]);
        expectNoExecutableStringSources(directives);
    });

    it('admits local demo images without admitting remote image origins', () => {
        const policies = [
            ...BUILD_PROFILES.map((profile) => parsePolicy(contentSecurityPolicyFor(profile))),
            parsePolicy(policyFromMetaTag(
                readFileSync(resolve(REPO, 'packages/desktop/renderer/index.html'), 'utf8'),
            )),
            parsePolicy(JSON.parse(
                readFileSync(resolve(REPO, 'packages/extension/manifest.json'), 'utf8'),
            ).content_security_policy.extension_pages),
        ];

        expect(Object.values(DEMO_TOKEN_ICONS).every((url) => url.startsWith('data:image/'))).toBe(true);
        for (const directives of policies) {
            expect(directives['img-src']).toContain('data:');
            expect(directives['img-src'].some((source) => /^https?:/i.test(source))).toBe(false);
        }
    });
});
