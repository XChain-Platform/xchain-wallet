#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, writeFileSync } from 'node:fs';
import {
    UPDATE_FEED_MAX_BYTES,
    parseReleaseFeed,
} from '../../packages/core/src/shared/releaseFeed.js';
import { isInvokedDirectly } from './is-invoked-directly.mjs';

export const USAGE = `Usage: node tools/release/releases-json.mjs build --input <file> --out <file> [--verify-served <public base>]

Build the wallet releases.json feed from a release-manager-edited JSON file.
The client parser validates versions, channels, and HTTPS update hosts. Output
is deterministic, uses two-space indentation and a trailing newline, and must
fit within the client's ${UPDATE_FEED_MAX_BYTES}-byte feed limit.

  --input <file>                 source feed declaration
  --out <file>                   generated releases.json
  --verify-served <public base>  require RELEASE_HASHES/v<latest>.txt to return HTTP 200
`;

export async function buildReleaseJson({ input, out, verifyServed, fetchImpl = globalThis.fetch }) {
    const source = JSON.parse(readFileSync(input, 'utf8'));
    const feed = parseReleaseFeed(source);
    if (verifyServed) await verifyServedManifest(feed.latest, verifyServed, fetchImpl);
    const json = `${JSON.stringify(sortKeys(feed), null, 2)}\n`;
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > UPDATE_FEED_MAX_BYTES) {
        throw new Error(`generated feed is ${bytes} bytes; client limit is ${UPDATE_FEED_MAX_BYTES}`);
    }
    writeFileSync(out, json, 'utf8');
    return { feed, json, bytes };
}

export async function verifyServedManifest(latest, publicBase, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable for --verify-served');
    let base;
    try {
        base = new URL(publicBase);
    } catch {
        throw new Error(`invalid --verify-served base: ${publicBase}`);
    }
    if (base.protocol !== 'https:' || base.search || base.hash) {
        throw new Error('--verify-served base must be an HTTPS URL without a query or fragment');
    }
    const manifestUrl = `${base.href.replace(/\/+$/, '')}/RELEASE_HASHES/v${latest}.txt`;
    const response = await fetchImpl(manifestUrl, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
    });
    if (response?.status !== 200) {
        throw new Error(`served manifest check returned HTTP ${response?.status ?? 'unknown'} for ${manifestUrl}`);
    }
    return manifestUrl;
}

export async function run(args, dependencies = {}) {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        return { help: true };
    }
    if (args[0] !== 'build') {
        throw new Error(args.length === 0 ? 'missing command' : `unknown command "${args[0]}"`);
    }
    const options = {};
    for (let index = 1; index < args.length; index += 1) {
        const option = args[index];
        if (!['--input', '--out', '--verify-served'].includes(option)) {
            throw new Error(`unknown option "${option}"`);
        }
        if (Object.hasOwn(options, option)) throw new Error(`duplicate option "${option}"`);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
        options[option] = value;
        index += 1;
    }
    if (!options['--input']) throw new Error('build requires --input <file>');
    if (!options['--out']) throw new Error('build requires --out <file>');
    return buildReleaseJson({
        input: options['--input'],
        out: options['--out'],
        verifyServed: options['--verify-served'],
        fetchImpl: dependencies.fetchImpl,
    });
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

if (isInvokedDirectly(import.meta.url)) {
    try {
        const result = await run(process.argv.slice(2));
        if (result.help) process.stdout.write(USAGE);
        else process.stdout.write(`wrote ${result.bytes} bytes to ${process.argv[process.argv.indexOf('--out') + 1]}\n`);
    } catch (error) {
        process.stderr.write(`releases-json.mjs: ${error instanceof Error ? error.message : String(error)}\n`);
        process.stderr.write('Run with --help for usage.\n');
        process.exitCode = 1;
    }
}
