#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TOPICS = resolve(ROOT, 'packages/web/src/style-guide/rulingTopics.json');
const DEFAULT_OUT = resolve(ROOT, 'packages/web/src/style-guide/rulings.json');
const SHA = String.raw`(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}`;
const SHA_LIST = `${SHA}(?:(?:, | and )${SHA})*`;

function cells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function publicText(value) {
    return value
        .replace(/(?:\/Users\/|~\/)[^\s,;)]+\.(?:png|html)\b/g, 'the approved layout image')
        .replace(/the [a-z]{2}\d{4}[a-z]? walk \(\d+\)/gi, 'a walk')
        .replace(new RegExp(`;\\s*xchain-wallet ${SHA_LIST}`, 'gi'), '')
        .replace(new RegExp(`\\s*\\((?:xchain-wallet )?${SHA_LIST}\\)`, 'gi'), '')
        .replace(new RegExp(SHA_LIST, 'gi'), (list) => /, | and /.test(list) ? 'earlier changes' : 'an earlier change')
        .replace(/\s*\(n\.\d+(?:,\s*\d+(?![\d-]))*\)/g, '')
        .replace(/,\s*n\.\d+(?:,\s*\d+(?![\d-]))*/g, '')
        .replace(/\(n\.\d+(?:,\s*\d+(?![\d-]))*,\s*/g, '(')
        .trim();
}

export function parseRulings(markdown) {
    const rulings = [];
    let section = '';
    for (const line of markdown.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) section = heading[1];
        if (!line.trim().startsWith('|')) continue;
        const row = cells(line);
        const id = row[0];
        if (section === 'Style guide' && /^G\d+$/.test(id)) {
            rulings.push({ id, kind: 'G', binding: true, supersededBy: null, scope: null, text: publicText(row[1]) });
        } else if (section === 'Rulings' && /^U\d+$/.test(id) && (row.length === 3 || row.length === 7)) {
            const compact = row.length === 3;
            const status = compact ? 'binding' : row[6];
            const scope = compact ? 'W X D M' : row[3];
            const superseded = status.match(/superseded by ([GPU]\d+)/i);
            rulings.push({
                id,
                kind: 'U',
                binding: !/^(?:superseded|proposed)\b/i.test(status),
                supersededBy: superseded?.[1] ?? null,
                scope: scope.split(/\s+/),
                text: scope === 'process' ? null : publicText(row[2]),
            });
        } else if (section === 'Process rulings' && /^P\d+$/.test(id) && row.length === 4) {
            rulings.push({ id, kind: 'P', binding: true, supersededBy: null, scope: ['process'], text: null });
        }
    }
    return rulings;
}

export function buildExport(markdown, topics) {
    const rulings = parseRulings(markdown);
    const ids = new Set(rulings.map(({ id }) => id));
    const missing = rulings.find(({ id }) => !topics[id]);
    if (missing) throw new Error(`missing topic for ${missing.id}`);
    const unknown = Object.keys(topics).find((id) => !ids.has(id));
    if (unknown) throw new Error(`topic for unknown id ${unknown}`);
    const counts = { G: 0, U: 0, P: 0 };
    const records = rulings.map(({ id, kind, binding, supersededBy, scope, text }) => {
        counts[kind] += 1;
        return { id, kind, binding, supersededBy, scope, topic: topics[id], text };
    });
    return `${JSON.stringify({ counts, rulings: records }, null, 2)}\n`;
}

function options(argv) {
    const parsed = { topics: DEFAULT_TOPICS, out: DEFAULT_OUT, check: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--check') parsed.check = true;
        else if (['--doc', '--topics', '--out'].includes(arg) && argv[index + 1]) parsed[arg.slice(2)] = resolve(argv[++index]);
        else throw new Error(`unknown or incomplete option: ${arg}`);
    }
    if (!parsed.doc) throw new Error('--doc is required');
    return parsed;
}

function firstDifference(expected, actual) {
    try {
        const left = JSON.parse(expected);
        const right = JSON.parse(actual);
        if (JSON.stringify(left.counts) !== JSON.stringify(right.counts)) return 'counts';
        const size = Math.max(left.rulings.length, right.rulings.length);
        for (let index = 0; index < size; index += 1) {
            if (JSON.stringify(left.rulings[index]) !== JSON.stringify(right.rulings[index])) {
                return left.rulings[index]?.id ?? right.rulings[index]?.id ?? 'counts';
            }
        }
    } catch {}
    return 'counts';
}

async function main() {
    try {
        const config = options(process.argv.slice(2));
        const [markdown, topicSource] = await Promise.all([readFile(config.doc, 'utf8'), readFile(config.topics, 'utf8')]);
        const output = buildExport(markdown, JSON.parse(topicSource));
        if (!config.check) return void await writeFile(config.out, output);
        const current = await readFile(config.out, 'utf8').catch(() => '');
        if (current !== output) {
            console.error(`rulings export differs at ${firstDifference(output, current)}`);
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
