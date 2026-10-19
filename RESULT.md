# Lane report: cx-xc-5842

Files touched: test/e2e/playwright.config.js

Cause named by the failed attempt: webServer.reuseExistingServer was
`!process.env.CI`, so with CI set and port 5173 already held Playwright
aborted before any spec ran. Fixed by always reusing a running server.
Also added an optional PW_CHROMIUM_PATH env override for launchOptions.executablePath
(the host had Chromium rev 1194, Playwright expects 1217; unset it changes nothing).

Test command (with PW_CHROMIUM_PATH=/opt/pw-browsers/chromium, after pnpm install):
npx playwright test --config test/e2e/playwright.config.js test/e2e/tests/layout/reachability-details-alignment.spec.js test/e2e/tests/regressions/device-pass-layout.spec.js
Result: 8 passed, 0 failed.

Notes: the spec and Home.jsx needed no change at this base; the Details tests pass as is.
The verify host needs a Chromium matching Playwright or PW_CHROMIUM_PATH set.

RUN-COMPLETE 15e41fb62b846775291a9c922b50c306
