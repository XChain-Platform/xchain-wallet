import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { buildExport } from './export-ui-rulings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const scratchRoot = join(root, 'tmp');
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(scratchRoot, 'export-ui-rulings-'));
after(() => rm(scratch, { recursive: true, force: true }));

const markdown = await readFile(join(here, 'fixtures/rulings-sample.md'), 'utf8');
const topics = JSON.parse(await readFile(join(here, 'fixtures/topics-sample.json'), 'utf8'));

test('exports every supported ruling shape and skips the Superseded table', () => {
    const first = buildExport(markdown, topics);
    const second = buildExport(markdown, topics);
    assert.equal(first, second);
    assert.equal(first.endsWith('\n'), true);

    const exported = JSON.parse(first);
    assert.deepEqual(exported.counts, { G: 1, U: 6, P: 1 });
    assert.deepEqual(exported.rulings, [
        {
            id: 'G05', kind: 'G', binding: true, supersededBy: null, scope: null,
            text: 'A browse page with views puts icon tabs directly above its list: Contracts All, Mine and Interactions; Prediction markets All, My predictions and My markets. All is the default. The one exception to G04 is Dispenser explorer, which the operator picked with its search first, then Popular, Newest and Best deals tabs, and Network in the filter.',
            topic: 'browse-views',
        },
        {
            id: 'U55', kind: 'U', binding: true, supersededBy: null, scope: ['W', 'X', 'D', 'M'],
            topic: 'protocol-fees',
            text: "An action with a protocol-fee path in xchain-indexer shows the Fees card (Layout 1, the approved layout image). Revised 2026-11-12 (D4, G20): the form shows only the Form Standard's Network fee row (FeeSection), with the protocol fee in its summary and the pay-in-native-coin switch inside the opened row, and the Fees card appears only on the shared confirm screen as its cost card. The card is a Network fee row and a Protocol fee row, each with coin amount and fiat, and a Total row that reads one coin total plus fiat when the protocol fee is paid in the native coin (\"0.00001697 BTC ~$1.11\") and \"0.000015 BTC + 0.064 XCHAIN ~$1.11\" when it is paid in XCHAIN; fiat is always written \"~$1.11\", never \"about\", on every row. The actions with a protocol-fee path (verified in xchain-indexer src/actions, 2026-11-09) are AIRDROP, BATCH, BET, CALLBACK, DEPLOY (and chunks), DISPENSER, DIVIDEND, EXECUTE, ISSUE (new token only; any update to an existing token is free, issue/fees.js:78), LIST, ORDER, SWAP, SWEEP and XBRIDGE. Every other form (SEND, MINT, DESTROY, SLEEP, BROADCAST, FILE, LINK, ADDRESS, PRICE, token updates and the rest) shows only the plain Network fee row (U54) and never the pay-in-native switch or a protocol-fee line. On Litecoin and Dogecoin, where the native output is the protocol fee, the switch shows on and locked.",
        },
        {
            id: 'U100', kind: 'U', binding: true, supersededBy: null, scope: ['W', 'X', 'D', 'M'],
            text: 'No notice, banner, toast or prompt carries a "Dismiss" text button. Closing one is the standard Notice X in its top right corner (G120), the same X every notice uses; a second action button stays only when it does something other than close (for example "Remind me tomorrow" or "Discard draft"). Seen on the desktop update banner during a walk.',
            topic: 'notice-close',
        },
        {
            id: 'U47', kind: 'U', binding: false, supersededBy: 'U76', scope: ['W', 'X', 'D', 'M'],
            text: 'Token detail quick actions (Send, Receive, Market view, History) are one horizontal row of compact buttons, never full-width list rows (reverts earlier changes).',
            topic: 'token-actions',
        },
        {
            id: 'U101', kind: 'U', binding: false, supersededBy: null, scope: ['W', 'X', 'D', 'M'],
            text: 'When a notice lists more than one issue (the checks the network could not verify on Confirm, a form error summary, any list of problems), each issue is its own bullet in a bulleted list inside the notice, never stacked plain lines. Seen on the Confirm "Only partly checked" notice during a walk.',
            topic: 'notice-issues',
        },
        {
            id: 'U102', kind: 'U', binding: false, supersededBy: null, scope: ['W', 'X', 'D', 'M'],
            text: "A page title shows once. On the first-run licence page it is the boot page header's title (G109), so the card under the logo carries no \"License Agreement\" heading; the Add Wallet path, which has no page header, keeps it on the card. A screen's heading takes focus for screen readers but draws its focus box only for keyboard users, never on first load or after a click. Operator, installed extension popup.",
            topic: 'page-title',
        },
        {
            id: 'U20', kind: 'U', binding: true, supersededBy: null, scope: ['process'], text: null,
            topic: 'visual-review',
        },
        {
            id: 'P01', kind: 'P', binding: true, supersededBy: null, scope: ['process'], text: null,
            topic: 'process-budget',
        },
    ]);
    assert.equal(exported.rulings.some(({ id }) => id === 'U08'), false);
    assert.equal(first.includes('Accept and Continue at the bottom'), false);
});

test('two CLI exports are byte-identical', async () => {
    const script = join(here, 'export-ui-rulings.mjs');
    const doc = join(here, 'fixtures/rulings-sample.md');
    const topicFile = join(here, 'fixtures/topics-sample.json');
    const firstPath = join(scratch, 'first.json');
    const secondPath = join(scratch, 'second.json');
    for (const out of [firstPath, secondPath]) {
        const run = spawnSync(process.execPath, [script, '--doc', doc, '--topics', topicFile, '--out', out], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
    }
    assert.deepEqual(await readFile(firstPath), await readFile(secondPath));
});

test('rejects missing and unknown topics by id', () => {
    const missing = { ...topics };
    delete missing.U55;
    assert.throws(() => buildExport(markdown, missing), /missing topic for U55/);
    assert.throws(() => buildExport(markdown, { ...topics, U999: 'ignored' }), /topic for unknown id U999/);
});
