// Smoke for §37 / Cluster P FOLLOWUP 6 — form-draft retention surfaced
// in Settings → Privacy.
//
// Pins:
//   - schemas/settings.js exports FORM_DRAFT_TTL_OFF / _1H / _24H / _7D /
//     _DEFAULT / _OPTIONS constants and validates privacy.formDraftTtlMs
//     against the options list (v2-tolerant — undefined OK, anything
//     outside the allowed set rejects).
//   - useFormDraft accepts ttlMs=0 as a kill switch: load() returns null +
//     evicts any persisted entry, save() no-ops, clear() still works.
//   - Send + SignMessageForm read settings.privacy.formDraftTtlMs and
//     thread it into useFormDraft.
//   - PrivacySection mounts a FormDraftTtlRow with a 4-option dropdown
//     wired through update({ privacy: { formDraftTtlMs } }).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
    FORM_DRAFT_TTL_OPTIONS,
    validateSettings,
    createDefaultSettings,
} from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const hookSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useFormDraft.js'),
    'utf8',
);
const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
const signMsgSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'SignMessageForm.jsx'),
    'utf8',
);
const privacySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PrivacySection.jsx'),
    'utf8',
);

// ─── 1. constants + bounds ──────────────────────────────────────────────

assert.equal(FORM_DRAFT_TTL_OFF, 0, 'OFF = 0');
assert.equal(FORM_DRAFT_TTL_1H, 60 * 60 * 1000);
assert.equal(FORM_DRAFT_TTL_24H, 24 * 60 * 60 * 1000);
assert.equal(FORM_DRAFT_TTL_7D, 7 * 24 * 60 * 60 * 1000);
assert.equal(FORM_DRAFT_TTL_DEFAULT, FORM_DRAFT_TTL_24H);
assert.deepEqual(
    [...FORM_DRAFT_TTL_OPTIONS].sort((a, b) => a - b),
    [FORM_DRAFT_TTL_OFF, FORM_DRAFT_TTL_1H, FORM_DRAFT_TTL_24H, FORM_DRAFT_TTL_7D]
        .sort((a, b) => a - b),
    'OPTIONS contains exactly the four spec values',
);

// ─── 2. schema validator ────────────────────────────────────────────────

{
    const settings = {
        ...createDefaultSettings(),
        privacy: { ...createDefaultSettings().privacy, formDraftTtlMs: FORM_DRAFT_TTL_7D },
    };
    const ok = validateSettings(settings);
    assert.equal(ok.ok, true,
        'schema validates 7-day formDraftTtlMs: ' + JSON.stringify(ok.errors));
}
{
    const settings = {
        ...createDefaultSettings(),
        privacy: { ...createDefaultSettings().privacy, formDraftTtlMs: 12_345 },
    };
    const bad = validateSettings(settings);
    assert.equal(bad.ok, false, 'schema rejects out-of-set values');
}
{
    // undefined is fine (v2-tolerant default-24h at read time).
    const settings = createDefaultSettings();
    delete settings.privacy.formDraftTtlMs;
    assert.equal(validateSettings(settings).ok, true,
        'schema accepts missing formDraftTtlMs');
}

// ─── 3. useFormDraft Off-mode behavior ────────────────────────────────

assert.match(hookSrc, /draftDisabled = ttlMs === 0/,
    'draftDisabled flag derived from ttlMs');
assert.match(
    hookSrc,
    /if \(draftDisabled\) \{[\s\S]+?store\.removeItem\(storageKey\)[\s\S]+?return null;/,
    'load() evicts + returns null when disabled',
);
assert.match(
    hookSrc,
    /save = useCallback\(\(values\) => \{\s*\n\s*if \(draftDisabled\) return;/,
    'save() short-circuits when disabled',
);

// ─── 4. call sites read settings ──────────────────────────────────────

assert.match(
    sendSrc,
    /Number\.isFinite\(settings\?\.privacy\?\.formDraftTtlMs\)[\s\S]+?useFormDraft\(\{[\s\S]+?ttlMs: formDraftTtlMs/,
    'Send.jsx threads settings.privacy.formDraftTtlMs into useFormDraft',
);
assert.match(
    signMsgSrc,
    /Number\.isFinite\(settings\?\.privacy\?\.formDraftTtlMs\)[\s\S]+?useFormDraft\(\{[\s\S]+?ttlMs: formDraftTtlMs/,
    'SignMessageForm threads settings.privacy.formDraftTtlMs into useFormDraft',
);
assert.match(
    signMsgSrc,
    /import \{ useSettings \} from '\.\.\/hooks\/useSettings\.js'/,
    'SignMessageForm imports useSettings (added for the threading)',
);

// ─── 5. PrivacySection wiring ──────────────────────────────────────────

assert.match(
    privacySrc,
    /<FormDraftTtlRow settings=\{settings\} update=\{update\} \/>/,
    'PrivacySection mounts FormDraftTtlRow',
);
assert.match(
    privacySrc,
    /function FormDraftTtlRow\(/,
    'FormDraftTtlRow component defined',
);
assert.match(
    privacySrc,
    /<select[\s\S]+?aria-label="Form draft retention"[\s\S]+?<option value=\{FORM_DRAFT_TTL_OFF\}>Off<\/option>[\s\S]+?<option value=\{FORM_DRAFT_TTL_7D\}>7 days<\/option>/,
    'select renders all four options with the right labels',
);
assert.match(
    privacySrc,
    /update\(\{ privacy: \{ formDraftTtlMs: next \} \}\)/,
    'onChange writes formDraftTtlMs to privacy settings',
);

console.log('form-draft-retention smoke OK');
