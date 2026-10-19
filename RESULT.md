# Lane report: cx-xc-5843

## Files touched
- test/e2e/tests/regressions/page-header-actions-have-icons.spec.js

## Diagnosis
The demo wallet owns no tokens, so MyTokens.jsx hides the actions-row button and
renders the EmptyState action, named "Issue token". The spec looked for the exact
name "Issue new token" and found 0 elements. MyTokens.jsx behaves as designed and
was left unchanged; the spec now accepts either name (same approach as My orders
and My swaps).

## Test commands
- `npx playwright test --config test/e2e/playwright.config.js test/e2e/tests/regressions/page-header-actions-have-icons.spec.js`
  - Before the fix (run via a throwaway wrapper config): 1 failed, 0 passed.
  - After the fix: 1 passed, 0 failed.
  - The exact command could not launch a browser here: the sandbox has Chromium
    build 1194 but the installed Playwright wants 1217. I ran the same config
    through an uncommitted wrapper that sets executablePath; the wrapper was
    deleted. Run the exact command on a machine with matching browsers to confirm.
- `pnpm install --frozen-lockfile` was needed first (no committed changes).

## Notes
- No other paths committed. tmp/ holds scratch logs and is not committed.
RUN-COMPLETE 4f150af5dd825a505dea1d65c8116f26
