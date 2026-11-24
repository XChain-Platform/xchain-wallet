// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { isInvokedDirectly } from '../release/is-invoked-directly.mjs';

const INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url));
const VALIDATION_ORIGIN = 'http://probe.invalid';

function redirectLocation(target, allowHosts) {
    if (!target) return null;

    if (target.startsWith('/') && !target.startsWith('//')) {
        const url = new URL(target, VALIDATION_ORIGIN);
        if (url.origin !== VALIDATION_ORIGIN) return null;
        url.hash = '';
        return `${url.pathname}${url.search}`;
    }

    let url;
    try {
        url = new URL(target);
    } catch {
        return null;
    }
    if (!['http:', 'https:'].includes(url.protocol) || !allowHosts.has(url.host)) {
        return null;
    }
    url.hash = '';
    return url.href;
}

export function createProbeServer({ allowHosts = [] } = {}) {
    const allowed = new Set(allowHosts);

    return createServer((request, response) => {
        let requestUrl;
        try {
            requestUrl = new URL(request.url, VALIDATION_ORIGIN);
        } catch {
            response.writeHead(400);
            response.end();
            return;
        }

        if (request.method === 'GET'
            && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(INDEX_HTML);
            return;
        }

        if (request.method === 'GET' && requestUrl.pathname === '/r302') {
            const location = redirectLocation(requestUrl.searchParams.get('to'), allowed);
            if (location === null) {
                response.writeHead(400, { 'Cache-Control': 'no-store' });
                response.end();
                return;
            }
            response.writeHead(302, {
                'Cache-Control': 'no-store',
                Location: location,
            });
            response.end();
            return;
        }

        response.writeHead(404);
        response.end();
    });
}

function parseArguments(args) {
    const options = { allowHosts: [], host: '127.0.0.1', port: 8765 };
    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        const value = args[index + 1];
        if (!['--allow', '--host', '--port'].includes(option) || value === undefined) {
            throw new Error(`Invalid argument: ${option}`);
        }
        index += 1;
        if (option === '--allow') options.allowHosts.push(value);
        if (option === '--host') options.host = value;
        if (option === '--port') {
            const port = Number(value);
            if (!Number.isInteger(port) || port < 0 || port > 65_535) {
                throw new Error(`Invalid port: ${value}`);
            }
            options.port = port;
        }
    }
    return options;
}

if (isInvokedDirectly(import.meta.url)) {
    try {
        const { allowHosts, host, port } = parseArguments(process.argv.slice(2));
        const server = createProbeServer({ allowHosts });
        server.listen(port, host, () => {
            const address = server.address();
            process.stdout.write(`probe: http://${host}:${address.port}/\n`);
        });
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
