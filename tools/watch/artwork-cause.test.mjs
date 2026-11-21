import assert from 'node:assert/strict';
import test from 'node:test';

import { artworkFailureCause, renderedShare } from './probe-artwork.mjs';

test('classifies a tainted canvas failure', () => {
    const error = new DOMException('The canvas has been tainted', 'SecurityError');
    assert.equal(artworkFailureCause({ error }), 'taint');
});

test('classifies an SVG source', () => {
    assert.equal(artworkFailureCause({ contentType: 'image/svg+xml' }), 'svg');
});

test('classifies an AVIF source', () => {
    assert.equal(artworkFailureCause({ sourceType: 'avif' }), 'avif');
});

test('classifies artwork over 5 MiB as oversized', () => {
    assert.equal(artworkFailureCause({ byteLength: 5 * 1024 * 1024 }), 'unknown');
    assert.equal(artworkFailureCause({ byteLength: (5 * 1024 * 1024) + 1 }), 'oversize');
});

test('classifies image and connection CSP refusals', () => {
    assert.equal(artworkFailureCause({ cspDirective: "img-src 'self'" }), 'csp');
    assert.equal(artworkFailureCause({ cspDirective: 'connect-src' }), 'csp');
});

test('classifies an unrecognised failure as unknown', () => {
    assert.equal(artworkFailureCause({
        sourceType: 'png',
        error: new Error('Image decoding failed'),
    }), 'unknown');
});

function results(rendered, total, sourceType = 'png') {
    return Array.from({ length: total }, (_, index) => ({
        sourceType,
        rendered: index < rendered,
    }));
}

test('reports a mixed eligible set below the target at 89 percent', () => {
    const mixed = [
        ...results(44, 50, 'image/png'),
        ...results(45, 50, 'jpeg'),
        ...results(1, 1, 'svg'),
    ];

    assert.deepEqual(renderedShare(mixed), {
        share: 0.89,
        reaches90Percent: false,
    });
});

test('reports a mixed eligible set at the 90 percent target', () => {
    const mixed = [
        ...results(45, 50, 'gif'),
        ...results(45, 50, 'image/webp'),
        ...results(0, 1, 'avif'),
    ];

    assert.deepEqual(renderedShare(mixed), {
        share: 0.9,
        reaches90Percent: true,
    });
});

test('reports zero for an empty set', () => {
    assert.deepEqual(renderedShare([]), {
        share: 0,
        reaches90Percent: false,
    });
});
