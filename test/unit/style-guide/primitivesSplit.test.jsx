// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sectionRoot = path.resolve(
    import.meta.dirname,
    '../../../packages/web/src/style-guide/sections',
);

const groups = {
    DisplayPrimitivesSection: [
        'AddressTextSection',
        'ChainBadgeSection',
        'CopyButtonSection',
        'InfoTipSection',
        'MultisigBadgeSection',
        'VerifiedBadgeSection',
    ],
    ListPartsSections: [
        'ExpirationChoiceSection',
        'ListFieldSection',
        'ListFilterPopoverSection',
        'ListSearchFieldSection',
    ],
    QrPrimitivesSection: [
        'AnimatedQrFramesSection',
        'KeyQrSection',
        'QrScannerSection',
    ],
};

describe('split style guide primitive sections', () => {
    it('keeps each section implementation in its own file', () => {
        for (const sections of Object.values(groups)) {
            for (const section of sections) {
                const source = fs.readFileSync(path.join(sectionRoot, `${section}.jsx`), 'utf8');
                expect(source).toContain(`export function ${section}()`);
                expect(source.match(/export function /g)).toHaveLength(1);
            }
        }
    });

    it('keeps the old modules as compatibility shims', async () => {
        for (const [legacyFile, sections] of Object.entries(groups)) {
            const legacy = await import(`../../../packages/web/src/style-guide/sections/${legacyFile}.jsx`);
            const source = fs.readFileSync(path.join(sectionRoot, `${legacyFile}.jsx`), 'utf8');

            expect(source).not.toContain('export function');
            for (const section of sections) {
                const split = await import(`../../../packages/web/src/style-guide/sections/${section}.jsx`);
                expect(legacy[section]).toBe(split[section]);
            }
        }
    });
});
