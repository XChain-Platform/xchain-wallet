// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_PREVIEW_PORT = 4193;
const ERROR_CODE_RE = /^[A-Za-z_]{2,40}$/;
const SERVICES = Object.freeze([
    ['encoder', 'encoderUrl'],
    ['explorer', 'explorerUrl'],
    ['hub', 'hubUrl'],
]);

export function suiteOrigin(env = process.env) {
    return `http://localhost:${suitePort(env)}`;
}

export function suitePort(env = process.env) {
    const port = Number(env.XC_PREVIEW_PORT);
    return Number.isInteger(port) && port >= 1 && port <= 65535
        ? port
        : DEFAULT_PREVIEW_PORT;
}

function rejectionCode(error) {
    const code = error?.cause?.code ?? error?.code ?? error?.name;
    return typeof code === 'string' && ERROR_CODE_RE.test(code) ? code : 'unknown';
}

export async function assertOriginsAllowed(
    endpoints,
    { origin, fetch = globalThis.fetch },
) {
    const checks = SERVICES
        .filter(([, endpoint]) => endpoints[endpoint])
        .map(async ([role, endpoint]) => {
            try {
                const response = await fetch(endpoints[endpoint], {
                    method: 'OPTIONS',
                    headers: {
                        Origin: origin,
                        'Access-Control-Request-Method': 'POST',
                        'Access-Control-Request-Headers': 'content-type',
                    },
                });
                const allowedOrigin = response.headers.get('access-control-allow-origin');
                const allowed = response.status >= 200 && response.status < 300
                    && (allowedOrigin === '*' || allowedOrigin === origin);
                if (!allowed) {
                    return `${role} for ${origin} (status ${response.status}; `
                        + `access-control-allow-origin: ${allowedOrigin ?? 'none'})`;
                }
                return null;
            } catch (error) {
                return `${role} for ${origin} (fetch rejected: ${rejectionCode(error)})`;
            }
        });
    const refused = (await Promise.all(checks)).filter(Boolean);
    if (refused.length > 0) {
        throw new Error(`Origin preflight refused: ${refused.join('; ')}`);
    }
}

export async function runOriginPreflight({
    env = process.env,
    endpoints,
    fetch = globalThis.fetch,
    log = console.error,
} = {}) {
    try {
        let resolvedEndpoints = endpoints;
        if (resolvedEndpoints === undefined) {
            const { testnetEndpoints } = await import('./testnet.js');
            resolvedEndpoints = testnetEndpoints();
        }
        await assertOriginsAllowed(resolvedEndpoints, { origin: suiteOrigin(env), fetch });
        return 0;
    } catch (error) {
        log(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    process.exitCode = await runOriginPreflight();
}
