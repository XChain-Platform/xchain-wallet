// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

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

for (const [relativePath, expectedCount] of fullyDeferred) {
    const images = imageTags(relativePath);
    assert.equal(images.length, expectedCount, `${relativePath} image inventory`);
    for (const image of images) {
        const attrs = attributes(image);
        assert.equal(literalValue(attrs.get('loading')), 'lazy', `${relativePath} uses lazy loading`);
        assert.equal(literalValue(attrs.get('decoding')), 'async', `${relativePath} uses async decoding`);
    }
}

for (const relativePath of [
    'packages/core/src/shared/routes/AttachContentForm.jsx',
    'packages/core/src/shared/routes/GatedPublishForm.jsx',
    'packages/core/src/shared/routes/PublishFileForm.jsx',
]) {
    for (const image of imageTags(relativePath)) {
        const attrs = attributes(image);
        assert.ok(attrs.has('width') && attrs.has('height'), `${relativePath} reserves image dimensions`);
    }
}

const gatedImage = imageTags('packages/core/src/shared/components/GatedFileViewer.jsx')[0];
assert.match(gatedImage.source, /aspectRatio:\s*'1 \/ 1'/, 'gated image reserves an aspect ratio');

const mediaImage = imageTags('packages/core/src/shared/routes/TokenDetail.jsx')
    .find((image) => image.source.includes('className={styles.heroImage}'));
assert.ok(mediaImage, 'token media image remains in the source inventory');
const mediaAttrs = attributes(mediaImage);
assert.equal(literalValue(mediaAttrs.get('loading')), 'lazy', 'token media uses lazy loading');
assert.equal(literalValue(mediaAttrs.get('decoding')), 'async', 'token media uses async decoding');
assert.match(mediaImage.source, /aspectRatio:\s*'1 \/ 1'/, 'token media reserves an aspect ratio');

console.log('shared image loading smoke: PASS');
