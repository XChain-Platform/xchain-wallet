// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseLogNdjson(text) {
    const entries = [];

    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;

        let record;
        try {
            record = JSON.parse(line);
        } catch {
            continue;
        }

        if (!record || Array.isArray(record) || record.eventType !== 'logEvent'
            || typeof record.eventMessage !== 'string') continue;

        const imagePath = record.processImagePath;
        entries.push({
            timestamp: record.timestamp,
            processID: record.processID,
            process: typeof imagePath === 'string' ? imagePath.split('/').at(-1) : undefined,
            subsystem: record.subsystem,
            category: record.category,
            message: record.eventMessage,
        });
    }

    return entries;
}

export function findLogEntry(entries, fields) {
    return entries.find((entry) => (
        (fields.process === undefined || entry.process === fields.process)
        && (fields.subsystem === undefined || entry.subsystem === fields.subsystem)
        && (fields.category === undefined || entry.category === fields.category)
        && (fields.messageContains === undefined
            || entry.message.includes(fields.messageContains))
    )) ?? null;
}

function parseFindArguments(args) {
    const fields = {};
    const mappings = {
        '--contains': 'messageContains',
        '--process': 'process',
        '--subsystem': 'subsystem',
        '--category': 'category',
    };

    for (let index = 0; index < args.length; index += 2) {
        const field = mappings[args[index]];
        const value = args[index + 1];
        if (!field || value === undefined || value.startsWith('--')) return null;
        fields[field] = value;
    }

    return fields.messageContains === undefined ? null : fields;
}

function runCli(args) {
    const [verb, ...arguments_] = args;
    if (verb !== 'find') return 2;

    const fields = parseFindArguments(arguments_);
    if (!fields) return 2;

    const entries = parseLogNdjson(readFileSync(0, 'utf8'));
    if (findLogEntry(entries, fields)) return 0;

    process.stdout.write(`Log entry not found: ${fields.messageContains}\n`);
    return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = runCli(process.argv.slice(2));
}
