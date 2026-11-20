// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const DEFAULT_API_BASE = 'https://api.cloudflare.com/client/v4';
const USAGE = `Usage: node tools/release/cloudflare-purge.mjs <url> [url ...]

Purges exact URLs through Cloudflare using CLOUDFLARE_ZONE_ID and
CLOUDFLARE_PURGE_TOKEN. The token is read only from the environment.
`;

/** Purge exact URLs with the release token, returning the API response for diagnostics. */
export async function purgeCloudflareFiles(files, {
    zone = process.env.CLOUDFLARE_ZONE_ID,
    token = process.env.CLOUDFLARE_PURGE_TOKEN,
    // Test-only injection. Production callers leave this unset.
    apiBase = process.env.XCHAIN_TEST_CLOUDFLARE_API_BASE || DEFAULT_API_BASE,
} = {}) {
    if (!zone || !token) return { ok: false, error: 'Cloudflare zone or purge token is unset' };
    if (!Array.isArray(files) || files.length === 0) return { ok: false, error: 'no URLs were supplied' };

    let response;
    try {
        response = await fetch(`${apiBase.replace(/\/+$/, '')}/zones/${encodeURIComponent(zone)}/purge_cache`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ files }),
        });
    } catch (error) {
        return { ok: false, error: String(error?.cause?.message || error?.message || error) };
    }

    let body;
    try {
        body = await response.text();
    } catch (error) {
        return { ok: false, status: response.status, error: String(error?.message || error) };
    }
    let result;
    try {
        result = JSON.parse(body);
    } catch {
        result = null;
    }
    return { ok: result?.success === true, status: response.status, body };
}

function redact(value, token) {
    if (!token) return value;
    return value.split(token).join('[REDACTED]');
}

if (isInvokedDirectly(import.meta.url)) {
    const files = process.argv.slice(2);
    if (files.length === 1 && (files[0] === '--help' || files[0] === '-h')) {
        process.stdout.write(USAGE);
        process.exit(0);
    }
    if (files.length === 0) {
        process.stderr.write(USAGE);
        process.exit(2);
    }
    const token = process.env.CLOUDFLARE_PURGE_TOKEN || '';
    const result = await purgeCloudflareFiles(files);
    if (!result.ok) {
        if (result.body) {
            process.stderr.write(`cloudflare-purge: API failure (HTTP ${result.status}): ${redact(result.body, token)}\n`);
        } else {
            process.stderr.write(`cloudflare-purge: request failed: ${redact(result.error || 'unknown error', token)}\n`);
        }
        process.exitCode = 1;
    }
}
