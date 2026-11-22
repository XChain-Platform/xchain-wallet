import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WELL_KNOWN = resolve(process.cwd(), 'packages/web/public/.well-known');
const APPLE_ASSOCIATION = resolve(WELL_KNOWN, 'apple-app-site-association');
const ASSET_LINKS = resolve(WELL_KNOWN, 'assetlinks.json');

function readJson(path) {
    const bytes = readFileSync(path);
    const source = bytes.toString('utf8');

    return { bytes, source, value: JSON.parse(source) };
}

function expectCanonicalJson({ bytes, source, value }) {
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(source).toBe(`${JSON.stringify(value, null, 2)}\n`);
}

describe('wallet association files', () => {
    it('claims only the wallet link path for the iOS app', () => {
        const document = readJson(APPLE_ASSOCIATION);
        const { value } = document;

        expectCanonicalJson(document);
        expect(value).not.toHaveProperty('webcredentials');
        expect(value).not.toHaveProperty('appclips');
        expect(value.applinks.details).toHaveLength(1);

        const [detail] = value.applinks.details;
        expect(detail.appIDs).toHaveLength(1);
        expect(detail.appIDs[0]).toMatch(/^[A-Z0-9]{10}\.io\.xchain\.wallet\.ios$/);
        expect(detail.components).toHaveLength(1);
        expect(detail.components[0]['/']).toBe('/link/*');
        expect(detail.components[0].comment).toContain('wallet.xchain.io');
    });

    it('claims wallet URLs for the Android app with valid certificate fingerprints', () => {
        const document = readJson(ASSET_LINKS);
        const { value } = document;

        expectCanonicalJson(document);
        expect(value).toHaveLength(1);

        const [statement] = value;
        expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
        expect(statement.target.namespace).toBe('android_app');
        expect(statement.target.package_name).toBe('io.xchain.wallet.android');
        expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);

        for (const fingerprint of statement.target.sha256_cert_fingerprints) {
            expect(fingerprint).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
        }
    });
});
