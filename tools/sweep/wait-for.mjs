#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const POLL_MS = 100;

function usage(message) {
    const detail = message ? `${message}\n` : '';
    return `${detail}usage: wait-for.mjs (--file <path> [--contains <text>] | --port <n> | --http <url>) --timeout <s>`;
}

export function parseWaitArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!['--file', '--contains', '--port', '--http', '--timeout'].includes(arg)) {
            throw new Error(usage(`unknown argument: ${arg}`));
        }
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
            throw new Error(usage(`${arg} requires a value`));
        }
        options[arg.slice(2)] = value;
        i += 1;
    }

    const modes = ['file', 'port', 'http'].filter((key) => options[key] !== undefined);
    if (modes.length !== 1) throw new Error(usage('choose exactly one wait mode'));
    if (options.timeout === undefined) throw new Error(usage('--timeout is required'));
    const timeoutMs = Number(options.timeout) * 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(usage('--timeout must be a positive number'));
    }
    if (options.contains !== undefined && options.file === undefined) {
        throw new Error(usage('--contains requires --file'));
    }
    if (options.port !== undefined) {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(usage('--port must be an integer from 1 to 65535'));
        }
        options.port = port;
    }
    if (options.http !== undefined) {
        const url = new URL(options.http);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error(usage('--http requires an http or https URL'));
        }
        options.http = url.href;
    }
    return { ...options, timeoutMs };
}

function delay(ms) {
    return new Promise((done) => setTimeout(done, ms));
}

export async function waitUntil(check, timeoutMs, pollMs = POLL_MS) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        if (await check(Math.max(1, deadline - Date.now()))) return true;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await delay(Math.min(pollMs, remaining));
    }
}

export function fileCondition(path, contains) {
    return async () => {
        if (!existsSync(path)) return false;
        if (contains === undefined) return true;
        try {
            return readFileSync(path, 'utf8').includes(contains);
        } catch {
            return false;
        }
    };
}

export function portCondition(port) {
    return async (remainingMs = 500) => new Promise((done) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            done(result);
        };
        socket.setTimeout(Math.min(500, remainingMs), () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

export function httpCondition(url) {
    return async (remainingMs = 500) => {
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(Math.min(500, remainingMs)),
            });
            await response.body?.cancel();
            return response.status >= 200 && response.status < 300;
        } catch {
            return false;
        }
    };
}

export function waitDescription(options) {
    if (options.file !== undefined) {
        return options.contains === undefined
            ? `file ${options.file}`
            : `file ${options.file} containing ${JSON.stringify(options.contains)}`;
    }
    if (options.port !== undefined) return `port 127.0.0.1:${options.port}`;
    return `HTTP 2xx from ${options.http}`;
}

export async function waitFor(options) {
    let condition;
    if (options.file !== undefined) condition = fileCondition(options.file, options.contains);
    else if (options.port !== undefined) condition = portCondition(options.port);
    else condition = httpCondition(options.http);
    return waitUntil(condition, options.timeoutMs);
}

async function main() {
    let options;
    try {
        options = parseWaitArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
        return;
    }

    if (await waitFor(options)) return;
    console.error(`timed out after ${options.timeout}s waiting for ${waitDescription(options)}`);
    process.exitCode = 124;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    await main();
}
