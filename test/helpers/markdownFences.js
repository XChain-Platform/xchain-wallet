// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

function headingFrom(line) {
    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (!match) return null;
    return (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
}

function openingFence(line) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) return null;
    const info = match[3].trim();
    if (match[2][0] === '`' && info.includes('`')) return null;
    return {
        character: match[2][0],
        indent: match[1].length,
        lang: info ? info.split(/\s+/, 1)[0].toLowerCase() : '',
        length: match[2].length,
    };
}

function isClosingFence(line, { character, length }) {
    const match = /^( {0,3})(`+|~+)( *)$/.exec(line);
    return Boolean(match && match[2][0] === character && match[2].length >= length);
}

function dedent(line, indent) {
    let removed = 0;
    while (removed < indent && line[removed] === ' ') removed += 1;
    return line.slice(removed);
}

export function fencedBlocks(markdown) {
    const lines = markdown.split(/\r?\n/);
    const blocks = [];
    let heading = null;

    for (let index = 0; index < lines.length; index += 1) {
        const nextHeading = headingFrom(lines[index]);
        if (nextHeading !== null) {
            heading = nextHeading;
            continue;
        }

        const fence = openingFence(lines[index]);
        if (!fence) continue;

        const openingLine = index + 1;
        const code = [];
        index += 1;
        while (index < lines.length && !isClosingFence(lines[index], fence)) {
            code.push(dedent(lines[index], fence.indent));
            index += 1;
        }
        if (index === lines.length) throw new Error(`Unclosed fenced code block at line ${openingLine}`);

        blocks.push({
            lang: fence.lang,
            code: code.join('\n'),
            heading,
            line: openingLine,
        });
    }

    return blocks;
}

export function blocksUnder(markdown, heading, { lang } = {}) {
    return fencedBlocks(markdown).filter(
        (block) => block.heading === heading && (lang === undefined || block.lang === lang),
    );
}
