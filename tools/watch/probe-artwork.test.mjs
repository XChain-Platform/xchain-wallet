import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
    artworkFailureCause,
    probeArtworkSources,
    renderedShare,
} from './probe-artwork.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwJfWQAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

async function serve(handler) {
    const server = createServer(handler);
    await new Promise((accept, reject) => {
        server.once('error', reject).listen(0, '127.0.0.1', accept);
    });
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('classifies a local PNG, local SVG, and cross-origin tainted image', async (t) => {
    const local = await serve((request, response) => {
        const svg = request.url === '/vector.svg';
        response.setHeader('Content-Type', svg ? 'image/svg+xml' : 'image/png');
        response.end(svg ? SVG : PNG);
    });
    const remote = await serve((_request, response) => {
        response.setHeader('Content-Type', 'image/png');
        response.end(PNG);
    });
    t.after(() => Promise.all([local.server, remote.server].map(
        (server) => new Promise((accept) => server.close(accept)),
    )));

    let inspections = 0;
    const results = await probeArtworkSources([
        { source: `${local.origin}/pixel.png`, sourceType: 'png' },
        { source: `${local.origin}/vector.svg`, sourceType: 'svg' },
        { source: `${remote.origin}/tainted.png`, sourceType: 'png', crossOrigin: true },
    ], async (item) => {
        inspections += 1;
        const response = await fetch(item.source);
        const bytes = await response.arrayBuffer();
        if (item.crossOrigin) {
            throw new DOMException('canvas is not origin-clean', 'SecurityError');
        }
        return {
            contentType: response.headers.get('content-type'),
            byteLength: bytes.byteLength,
            rendered: true,
        };
    });

    assert.equal(inspections, 2);
    assert.deepEqual(results.map((result) => result.cause), ['rendered', 'svg', 'taint']);
});

test('leaves an HTTP failure unclassified', () => {
    assert.equal(artworkFailureCause({
        sourceType: 'png',
        error: new Error('HTTP 429'),
    }), 'unknown');
});

test('passes when the CSP allows no raster artwork', () => {
    assert.deepEqual(renderedShare([
        { sourceType: 'png', rendered: false, cause: 'csp' },
        { sourceType: 'jpeg', rendered: false, cspDirective: 'img-src' },
        { sourceType: 'svg', rendered: false, cause: 'svg' },
    ]), { share: 1, reaches90Percent: true });
});

test('excludes CSP-blocked rasters from the rendered threshold', () => {
    assert.deepEqual(renderedShare([
        { sourceType: 'png', rendered: true, cause: 'rendered' },
        { sourceType: 'webp', rendered: false, cause: 'csp' },
    ]), { share: 1, reaches90Percent: true });
});
