// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SOURCE_EXTENSIONS = /\.(?:html|js|jsx|json|ts|tsx)$/;

function packageSources() {
    return execFileSync('git', ['ls-files', 'packages'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((path) => SOURCE_EXTENSIONS.test(path));
}

function iframePolicyViolations(path, source) {
    const violations = [];
    const normalized = source.replaceAll('\\"', '"');
    for (const match of normalized.matchAll(/<iframe\b[^>]*>/gi)) {
        const tag = match[0];
        const linePrefix = normalized.slice(normalized.lastIndexOf('\n', match.index) + 1, match.index).trimStart();
        if (/^(?:\/\/|\/\*|\*)/.test(linePrefix)) continue;
        if (!/\ssandbox\s*=/i.test(tag)) violations.push(`${path}: missing sandbox`);
        if (!/\sreferrerpolicy\s*=/i.test(tag)) violations.push(`${path}: missing referrerPolicy`);
    }
    return violations;
}

describe('embedded content policy', () => {
    it('rejects an iframe when either required protection is absent', () => {
        expect(iframePolicyViolations('unsafe.jsx', '<iframe src="https://example.test" />'))
            .toEqual([
                'unsafe.jsx: missing sandbox',
                'unsafe.jsx: missing referrerPolicy',
            ]);
    });

    it('sandboxes every source-defined iframe and suppresses its referrer', () => {
        const violations = [];

        for (const path of packageSources()) {
            violations.push(...iframePolicyViolations(path, readFileSync(path, 'utf8')));
        }

        expect(violations).toEqual([]);
    });
});
