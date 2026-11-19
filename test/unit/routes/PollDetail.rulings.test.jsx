// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(
    here,
    '../../../packages/core/src/shared/routes/PollDetail.jsx',
), 'utf8');

describe('PollDetail vote-form rulings', () => {
    it('starts the Cast Vote form with the standard From section: a locked Network and picker-backed address', () => {
        const start = source.indexOf('<FormFrame\n                demoGuard={demoGuard}');
        expect(start).toBeGreaterThan(-1);
        const form = source.slice(start);
        expect(form).toMatch(/^<FormFrame[\s\S]*?label=\{t\('governance\.detail\.castVoteTitle'\)\}[\s\S]*?\{t\('governance\.detail\.signVote'\)\}/);
        expect(form).toMatch(/<FromSection[\s\S]*?lockNetwork[\s\S]*?onOpenPicker=\{\(\) => setSourcePickerOpen\(true\)\}/);
        expect(form).toMatch(/<FromSection[\s\S]*?addressHelp="The address casting this ballot\./);
        expect(form).toMatch(/<FeeSection/);
        expect(form).not.toMatch(/<FeeSelector/);
        expect(source).toMatch(/<OwnAddressPickerScreen[\s\S]*?chainId=\{chainId\}[\s\S]*?lockNetwork/);
    });

    it('labels the ballot group with help, gives split shares specific help, and draws the lone memo through MemoSection', () => {
        expect(source).toContain('<div id="poll-ballot" role="group" aria-labelledby={ballotLabelId}>');
        expect(source).toContain('aria="About ballot choices"');
        expect(source).toContain('A direct vote overrides any standing');
        expect(source).not.toMatch(/<p[^>]*>A direct vote overrides/);
        expect(source).toContain('help="The positive share of this address\'s voting weight assigned to this option."');
        expect(source).toMatch(/<MemoSection[\s\S]*?value=\{memo\}/);
    });

    it('pins vote icons, header-only review navigation, and the green Done action', () => {
        // The Vote tab has no "Your Vote" title, count line or tap hint; the
        // list's rows are the only way into Cast Vote (operator ruling 2026-11-13).
        expect(source).not.toContain('pickTitle');
        expect(source).not.toContain('pickNote');
        expect(source).not.toContain('tapToVote');
        expect(source).toContain("<OutcomeList label={t('governance.detail.choiceList')} options={choiceOptions} />");
        expect(source).not.toMatch(/<OutcomePick\b/);
        expect(source).toContain('icon={<Icon.SignIcon />}');
        expect(source).not.toContain('>Back</Button>');
        // Header Back walks review -> Cast Vote -> the poll -> the poll list.
        expect(source).toContain("onBack={stage === 'review'\n                ? () => { setSubmitError(null); setStage('cast'); }\n                : showCast ? backToPoll : onBack}");
        expect(source).toContain('<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>');
    });
});
