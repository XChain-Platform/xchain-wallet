// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { blocksUnder, fencedBlocks } from '../../helpers/markdownFences.js';

describe('fencedBlocks', () => {
    it('extracts backtick and tilde fences in document order', () => {
        const markdown = [
            '# Examples',
            '```JavaScript extra words',
            'const value = 1;',
            '```',
            '~~~BASH',
            'echo done',
            '~~~',
        ].join('\n');

        expect(fencedBlocks(markdown)).toEqual([
            { lang: 'javascript', code: 'const value = 1;', heading: 'Examples', line: 2 },
            { lang: 'bash', code: 'echo done', heading: 'Examples', line: 5 },
        ]);
    });

    it('keeps a shorter fence as code inside a longer fence', () => {
        const markdown = ['````md', '```', 'inside', '```', '````'].join('\n');

        expect(fencedBlocks(markdown)).toEqual([
            { lang: 'md', code: '```\ninside\n```', heading: null, line: 1 },
        ]);
    });

    it('removes up to the opening fence indentation from each code line', () => {
        const markdown = ['   ```text', '   alpha', ' beta', 'plain', '   ```'].join('\n');

        expect(fencedBlocks(markdown)).toEqual([
            { lang: 'text', code: 'alpha\nbeta\nplain', heading: null, line: 1 },
        ]);
    });

    it('uses an empty language for a fence with no info string', () => {
        expect(fencedBlocks('```\nplain\n```')).toEqual([
            { lang: '', code: 'plain', heading: null, line: 1 },
        ]);
    });

    it('does not treat a hash comment inside a bash fence as a heading', () => {
        const markdown = [
            '## Shell',
            '```bash',
            '# keep this comment',
            'echo yes',
            '```',
            '```json',
            '{}',
            '```',
        ].join('\n');

        expect(fencedBlocks(markdown)).toEqual([
            { lang: 'bash', code: '# keep this comment\necho yes', heading: 'Shell', line: 2 },
            { lang: 'json', code: '{}', heading: 'Shell', line: 6 },
        ]);
    });

    it('recognizes ATX heading levels one through six and trims closing hashes', () => {
        const markdown = [
            '# One',
            '```\n1\n```',
            '## Two ##',
            '```\n2\n```',
            '### Three',
            '```\n3\n```',
            '#### Four ####',
            '```\n4\n```',
            '##### Five',
            '```\n5\n```',
            '###### Six ######',
            '```\n6\n```',
        ].join('\n');

        expect(fencedBlocks(markdown).map((block) => block.heading)).toEqual([
            'One',
            'Two',
            'Three',
            'Four',
            'Five',
            'Six',
        ]);
    });

    it('throws an error naming the opening line for an unclosed fence', () => {
        expect(() => fencedBlocks('# Heading\ntext\n```js\nconst nope = true;')).toThrow(/line 3/i);
    });

    it('returns the same blocks for CRLF and LF input', () => {
        const lf = '# Heading\n~~~json\n{"ok":true}\n~~~\n';

        expect(fencedBlocks(lf.replaceAll('\n', '\r\n'))).toEqual(fencedBlocks(lf));
    });
});

describe('blocksUnder', () => {
    const markdown = [
        '# First',
        '```js',
        'one();',
        '```',
        '```bash',
        'echo two',
        '```',
        '# Second',
        '```js',
        'three();',
        '```',
    ].join('\n');

    it('keeps multiple blocks under an exact heading in document order', () => {
        expect(blocksUnder(markdown, 'First').map((block) => block.code)).toEqual(['one();', 'echo two']);
        expect(blocksUnder(markdown, 'first')).toEqual([]);
    });

    it('filters blocks by language when one is given', () => {
        expect(blocksUnder(markdown, 'First', { lang: 'bash' })).toEqual([
            { lang: 'bash', code: 'echo two', heading: 'First', line: 5 },
        ]);
    });
});
