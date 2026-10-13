import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { selectFastTests } from './ci_fast_select.js';

function select(changed, tests = []) {
    return selectFastTests(changed, {
        listTests: () => tests,
        findRequirers: () => []
    });
}

test('selects only a changed test file', () => {
    const changed = 'test/unit/crypto/aead.test.js';
    const other = 'test/unit/crypto/backup.test.js';
    const plan = select([changed], [changed, other]);
    assert.equal(plan.consensus, false);
    assert.deepEqual(plan.tests, [{ group: 'unit', file: changed }]);
});

test('widens every wallet consensus prefix', () => {
    for (const file of [
        'src/consensus/merkle.js',
        'src/coins/BTC.js',
        'src/protocol/constants.js',
        'bin/pins/wallet-identity.json'
    ]) {
        const plan = select([file]);
        assert.equal(plan.consensus, true, file);
        assert(plan.reasons.includes(`consensus: ${file}`), file);
        assert.deepEqual(plan.tests, []);
    }
});

test('keeps the fast selector wired without moving Playwright into the fast tier', () => {
    const script = fs.readFileSync('bin/ci-full.sh', 'utf8');
    const planInvocations = script.match(/^.*ci_fast_select\.js --plan.*$/gm) || [];
    assert.deepEqual(planInvocations, [
        '  if FAST_CI_PLAN="$(node bin/ci_fast_select.js --plan 2>&1)"; then'
    ]);
    assert(script.includes('run_tier "test (changed tests)" node bin/ci_fast_select.js --run'));
    assert(script.includes('run_tier "fast-tier selector self-test" node --test bin/ci_fast_select.test.js'));
    const fullOnly = script.match(/CI_TIER_FULL_ONLY=\(([\s\S]*?)\n\)/)?.[1] || '';
    assert(fullOnly.includes('"e2e: Playwright browsers"'));
    assert(fullOnly.includes('"e2e suite (test:e2e)"'));
    for (const [name, command] of [
        ['boundary suite (test:boundary)', 'pnpm test:boundary'],
        ['chaos suite (test:chaos)', 'pnpm test:chaos'],
        ['accessibility suite (test:a11y)', 'pnpm test:a11y']
    ]) {
        assert(script.includes(`run_tier "${name}" ${command}`), `${name} is a standalone tier`);
        assert(!fullOnly.includes(name), `${name} stays in the fast gate`);
    }
    assert(script.includes('export XCHAIN_CI_FULL_VITEST_TIERS=1'));

    const e2eSetup = fs.readFileSync('test/e2e/global-setup.ci.js', 'utf8');
    assert(e2eSetup.includes("process.env.XCHAIN_CI_FULL_VITEST_TIERS === '1'"),
        'Playwright skips suites already graded by ci-full');
});

test('does not report tests covered by explicit fast tiers as deferred', () => {
    for (const file of [
        'test/a11y/App.a11y.test.jsx',
        'test/boundary/network.test.js',
        'test/chaos/retry.test.js'
    ]) {
        const plan = select([file]);
        assert.equal(plan.consensus, false, file);
        assert.deepEqual(plan.reasons, [], file);
        assert.deepEqual(plan.tests, [], file);
    }
});
