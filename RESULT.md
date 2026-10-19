# Lane report: cx-xc-5843

## Files touched
- test/e2e/tests/regressions/page-header-actions-have-icons.spec.js

## Cause
The demo wallet owns no tokens, so MyTokens.jsx renders its EmptyState (button "Issue token") and hides the actions-row "Issue new token" button. The spec looked only for "Issue new token", so it found no content action. MyTokens.jsx behaves as designed and was not changed.

## Fix
The My tokens route now accepts /^(Issue token|Issue new token)$/, the same pattern the My orders and My swaps rows use.

## Test commands
- `npx playwright test --config test/e2e/playwright.config.js test/e2e/tests/regressions/page-header-actions-have-icons.spec.js`
  - Run as written: 0 passed, 1 failed (sandbox only: the installed Playwright wants chromium build 1217, the sandbox has 1194).
  - Re-run with a throwaway config (not committed) that wraps playwright.config.js and sets launchOptions.executablePath to the 1194 chromium: 1 passed, 0 failed (phone and desktop, all routes).

## Notes
- The harness sandbox needs a matching Playwright browser build to run the verify command unmodified.
- No files outside Surfaces were touched.

RUN-COMPLETE 108245163253beaa7b39936422bd9864
