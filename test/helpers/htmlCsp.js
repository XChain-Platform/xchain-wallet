// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const URL_ATTRIBUTES = new Set([
    'action',
    'background',
    'cite',
    'data',
    'formaction',
    'href',
    'poster',
    'src',
    'xlink:href',
]);

function withoutComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
}

function decodeCharacterReferences(value) {
    return value
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#([0-9]+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&colon;?/gi, ':')
        .replace(/&(?:tab|newline);?/gi, '');
}

function lineAt(source, index) {
    return source.slice(0, index).split('\n').length;
}

export function findInlineCspViolations(html) {
    const source = withoutComments(html);
    const violations = [];

    for (const match of source.matchAll(/<script\b[^>]*>/gi)) {
        if (!/\ssrc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(match[0])) {
            violations.push({ kind: 'inline script', line: lineAt(source, match.index) });
        }
    }

    for (const tag of source.matchAll(/<[a-z][^>]*>/gi)) {
        const attributes = tag[0].slice(tag[0].search(/\s|>/));
        for (const attribute of attributes.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
            const name = attribute[1].toLowerCase();
            const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
            const line = lineAt(source, tag.index + attribute.index);

            if (/^on[a-z]/i.test(name)) {
                violations.push({ kind: `inline event handler ${name}`, line });
            }

            const normalizedUrl = decodeCharacterReferences(value)
                .replace(/[\u0000-\u0020]/g, '')
                .toLowerCase();
            if (URL_ATTRIBUTES.has(name) && normalizedUrl.startsWith('javascript:')) {
                violations.push({ kind: `javascript URL in ${name}`, line });
            }
        }
    }

    return violations;
}
