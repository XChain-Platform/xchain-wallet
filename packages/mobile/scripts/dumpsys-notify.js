// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseNotificationDump(text) {
    const records = [];
    const lines = text.split(/\r?\n/);
    let record = null;
    let block = null;

    for (const line of lines) {
        if (line.includes('NotificationRecord(')) {
            record = parseRecordLine(line);
            records.push(record);
            block = null;
            continue;
        }

        if (!record) continue;

        const trimmed = line.trim();
        if (trimmed === 'extras={') {
            block = 'extras';
            continue;
        }
        if (trimmed === 'actions={') {
            block = 'actions';
            continue;
        }
        if (trimmed === '}') {
            block = null;
            continue;
        }

        if (block === 'extras') {
            const extra = /^android\.(title|text)=\S+ \((.*)\)$/.exec(trimmed);
            if (extra) record[extra[1]] = extra[2];
        } else if (block === 'actions') {
            const action = /^\[\d+] "(.*)" ->/.exec(trimmed);
            if (action) record.actions.push(action[1]);
        }
    }

    return records;
}

export function findNotification(records, fields) {
    return records.find((record) => (
        (fields.pkg === undefined || record.pkg === fields.pkg)
        && (fields.title === undefined || record.title === fields.title)
        && (fields.textContains === undefined || record.text?.includes(fields.textContains))
        && (fields.action === undefined || record.actions.includes(fields.action))
    )) ?? null;
}

function parseRecordLine(line) {
    const notificationOffset = line.indexOf('Notification(');
    const notification = notificationOffset === -1 ? '' : line.slice(notificationOffset);

    return {
        pkg: /\bpkg=([^,:\s]+)/.exec(line)?.[1],
        channel: /\bchannel=([^,\s)]+)/.exec(notification)?.[1],
        title: undefined,
        text: undefined,
        actions: [],
    };
}

function parseFindArguments(args) {
    const fields = {};
    const mappings = {
        '--title': 'title',
        '--text-contains': 'textContains',
        '--action': 'action',
        '--pkg': 'pkg',
    };

    for (let index = 0; index < args.length; index += 2) {
        const field = mappings[args[index]];
        const value = args[index + 1];
        if (!field || value === undefined || value.startsWith('--')) return null;
        fields[field] = value;
    }

    return fields.title === undefined ? null : fields;
}

function runCli(args) {
    const [verb, ...arguments_] = args;
    if (verb !== 'find') return 2;

    const fields = parseFindArguments(arguments_);
    if (!fields) return 2;

    const records = parseNotificationDump(readFileSync(0, 'utf8'));
    if (findNotification(records, fields)) return 0;

    process.stdout.write(`Notification not found: ${fields.title}\n`);
    return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = runCli(process.argv.slice(2));
}
