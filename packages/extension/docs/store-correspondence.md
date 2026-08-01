<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# Chrome Web Store correspondence log

**Status:** SCAFFOLD. No submission has happened yet; the entry below is a worked EXAMPLE only, not a real exchange.  
**Last updated:** 2026-07-31  
**Source item:**  (`claude/specs/wallet-publishing-chrome-extension.md`), §4 "On rejection", stage S1.

## Purpose and rule of use

Every exchange with a Chrome Web Store reviewer (a rejection notice, a policy warning, an appeal, a follow-up question, the eventual approval) gets one entry here, in full: what the reviewer said, what we replied, and the outcome. Per spec §4: "respond via the console appeal flow, never resubmit blind," and keep every reviewer exchange here "so resubmissions reuse language a reviewer has already accepted."

The practical payoff is that the second time a reviewer flags something similar (a permission justification that reads thin, a privacy-policy mismatch, a content-script question), the operator can search this file for language a reviewer has already accepted, instead of drafting a fresh response under a compliance clock and hoping it lands the same way. This file is the accumulated record of what the Web Store review process, specifically for this listing, actually wants.

Nothing secret goes in this file: no account credentials, no OAuth tokens. Reviewer correspondence itself is not typically secret, but redact anything that looks like an internal account identifier beyond the extension item ID.

## Entry format

Each entry:

- **Date:**  
- **Item:** main or beta  
- **Item version:** the version string under review  
- **Type:** rejection / policy warning / takedown notice / informational / approval  
- **Reviewer's stated reason (verbatim or close to it):**  
- **Our response (what we said, and/or a link to the exact text used):**  
- **Outcome:**  
- **Follow-up actions taken (code, policy, or listing-copy changes made because of this exchange):**

## Log

### EXAMPLE (not a real entry, 2026-01-01)

- **Date:** 2026-01-01
- **Item:** main
- **Item version:** 0.0.0-EXAMPLE
- **Type:** rejection
- **Reviewer's stated reason (verbatim or close to it):** "Your extension requests the `storage` permission but does not clearly justify this use in the single purpose description."
- **Our response (what we said, and/or a link to the exact text used):** Pointed the reviewer to the `storage` justification paragraph in `STORE_LISTING_PACK.md` §2 and copied it into the appeal form verbatim.
- **Outcome:** Appeal accepted; listing approved on resubmission.
- **Follow-up actions taken (code, policy, or listing-copy changes made because of this exchange):** None needed; the existing justification text was sufficient once submitted in the right field.
