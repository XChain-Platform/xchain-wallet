// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const fullyDeferred = new Map([
    ['packages/core/src/shared/components/BalanceList.jsx', 3],
    ['packages/core/src/shared/components/CollectiblesView.jsx', 2],
    ['packages/core/src/shared/components/GatedFileViewer.jsx', 1],
    ['packages/core/src/shared/components/HomeTabs.jsx', 7],
    ['packages/core/src/shared/routes/AttachContentForm.jsx', 2],
    ['packages/core/src/shared/routes/DispensersList.jsx', 2],
    ['packages/core/src/shared/routes/GatedPublishForm.jsx', 2],
    ['packages/core/src/shared/routes/PublishFileForm.jsx', 2],
]);

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue;
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
        else if (value?.type) walk(value, visit);
    }
}

function imageTags(relativePath) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
    const images = [];
    walk(ast, (node) => {
        if (node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier'
            && node.name.name === 'img') {
            images.push({
                node,
                source: source.slice(node.start, node.end),
            });
        }
    });
    return images;
}

function attributes(image) {
    return new Map(image.node.attributes
        .filter((attribute) => attribute.type === 'JSXAttribute')
        .map((attribute) => [attribute.name.name, attribute.value]));
}

function literalValue(attribute) {
    return attribute?.type === 'StringLiteral' ? attribute.value : null;
}

describe('shared image loading audit', () => {
    it('defers every image on scrollable content and preview surfaces', () => {
        for (const [relativePath, expectedCount] of fullyDeferred) {
            const images = imageTags(relativePath);
            expect(images, relativePath).toHaveLength(expectedCount);
            for (const image of images) {
                const attrs = attributes(image);
                expect(literalValue(attrs.get('loading')), relativePath).toBe('lazy');
                expect(literalValue(attrs.get('decoding')), relativePath).toBe('async');
            }
        }

        const mediaImage = imageTags('packages/core/src/shared/routes/TokenDetail.jsx')
            .find((image) => image.source.includes('className={styles.heroImage}'));
        expect(mediaImage).toBeDefined();
        const attrs = attributes(mediaImage);
        expect(literalValue(attrs.get('loading'))).toBe('lazy');
        expect(literalValue(attrs.get('decoding'))).toBe('async');
    });

    it('reserves layout space for variable-size content images', () => {
        for (const relativePath of [
            'packages/core/src/shared/routes/AttachContentForm.jsx',
            'packages/core/src/shared/routes/GatedPublishForm.jsx',
            'packages/core/src/shared/routes/PublishFileForm.jsx',
        ]) {
            for (const image of imageTags(relativePath)) {
                const attrs = attributes(image);
                expect(attrs.has('width'), relativePath).toBe(true);
                expect(attrs.has('height'), relativePath).toBe(true);
            }
        }

        const gatedImage = imageTags('packages/core/src/shared/components/GatedFileViewer.jsx')[0];
        expect(gatedImage.source).toContain("aspectRatio: '1 / 1'");

        const mediaImage = imageTags('packages/core/src/shared/routes/TokenDetail.jsx')
            .find((image) => image.source.includes('className={styles.heroImage}'));
        expect(mediaImage.source).toContain("aspectRatio: '1 / 1'");
    });
});
