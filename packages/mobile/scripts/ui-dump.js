// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseUiDump(xml) {
    const nodes = [];
    let offset = 0;

    while (offset < xml.length) {
        const start = xml.indexOf('<node', offset);
        if (start === -1) break;
        const afterName = xml[start + 5];
        if (afterName && !/[\s/>]/.test(afterName)) {
            offset = start + 5;
            continue;
        }

        const end = tagEnd(xml, start + 5);
        if (end === -1) break;
        const attributes = parseAttributes(xml.slice(start + 5, end));
        nodes.push({
            text: decodeXml(attributes.text ?? ''),
            contentDesc: decodeXml(attributes['content-desc'] ?? ''),
            resourceId: decodeXml(attributes['resource-id'] ?? ''),
            package: decodeXml(attributes.package ?? ''),
            bounds: parseBounds(decodeXml(attributes.bounds ?? '')),
        });
        offset = end + 1;
    }

    return nodes;
}

export function findNode(nodes, fields) {
    const mappings = [
        ['text', 'text', false],
        ['textContains', 'text', true],
        ['contentDesc', 'contentDesc', false],
        ['resourceId', 'resourceId', false],
    ];

    return nodes.find((node) => mappings.every(([field, property, contains]) => (
        fields[field] === undefined
        || (contains ? node[property].includes(fields[field]) : node[property] === fields[field])
    ))) ?? null;
}

export function tapPoint(node) {
    const [x1, y1, x2, y2] = node.bounds;
    return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)];
}

export function firstMissingLine(nodes, lines) {
    return lines.find((line) => !nodes.some(
        (node) => node.text === line || node.contentDesc === line,
    )) ?? null;
}

function tagEnd(xml, offset) {
    let quote = null;
    for (let index = offset; index < xml.length; index += 1) {
        const character = xml[index];
        if (quote) {
            if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '>') {
            return index;
        }
    }
    return -1;
}

function parseAttributes(source) {
    const attributes = {};
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of source.matchAll(pattern)) {
        attributes[match[1]] = match[2] ?? match[3];
    }
    return attributes;
}

function decodeXml(value) {
    const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
    };
    return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hex, named) => {
        if (named) return entities[named.toLowerCase()] ?? entity;
        const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : entity;
    });
}

function parseBounds(value) {
    const match = /^\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]$/.exec(value);
    if (!match) throw new TypeError(`Invalid UI node bounds: ${value}`);
    return match.slice(1).map(Number);
}

function runCli(args) {
    const [verb, ...arguments_] = args;
    const nodes = parseUiDump(readFileSync(0, 'utf8'));

    if (verb === 'tap' && arguments_.length === 2 && arguments_[0] === '--text') {
        const node = findNode(nodes, { text: arguments_[1] });
        if (!node) return 1;
        process.stdout.write(`${tapPoint(node).join(' ')}\n`);
        return 0;
    }

    if (verb === 'missing' && arguments_.length === 1) {
        const lines = JSON.parse(readFileSync(arguments_[0], 'utf8'));
        if (!Array.isArray(lines)) return 2;
        const missing = firstMissingLine(nodes, lines);
        if (missing === null) return 0;
        process.stdout.write(`${missing}\n`);
        return 1;
    }

    return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = runCli(process.argv.slice(2));
}
