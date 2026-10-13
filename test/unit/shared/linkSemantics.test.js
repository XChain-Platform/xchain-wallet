// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHARED = join(process.cwd(), 'packages/core/src/shared');

function jsxFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return jsxFiles(path);
        return entry.name.endsWith('.jsx') ? [path] : [];
    });
}

function anchorsIn(source) {
    return [...source.matchAll(/<a(?:\s|>)[\s\S]*?<\/a>/g)].map((match) => match[0]);
}

describe('shared link semantics', () => {
    it('gives every new-tab link opener protection and an external-link cue', () => {
        const faults = [];
        for (const file of jsxFiles(SHARED)) {
            for (const anchor of anchorsIn(readFileSync(file, 'utf8'))) {
                if (!anchor.includes('target="_blank"')) continue;
                if (!/rel="[^"]*noopener/.test(anchor)) faults.push(`${file}: missing noopener`);
                if (!/(↗|ExternalLinkIcon|opens? (in )?(a )?new tab)/i.test(anchor)) {
                    faults.push(`${file}: missing external-link cue`);
                }
            }
        }
        expect(faults).toEqual([]);
    });

    it('does not use placeholder anchors for actions', () => {
        const faults = jsxFiles(SHARED).filter((file) => (
            /<a\b[^>]*href="#"/.test(readFileSync(file, 'utf8'))
        ));
        expect(faults).toEqual([]);
    });
});
