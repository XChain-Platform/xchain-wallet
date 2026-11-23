# Wallet UI rulings sample

## Style guide

| Id | Rule | Why | Source | Replaces |
|---|---|---|---|---|
| G05 | A browse page with views puts icon tabs directly above its list: Contracts All, Mine and Interactions; Prediction markets All, My predictions and My markets. All is the default. The one exception to G04 is Dispenser explorer, which the operator picked with its search first, then Popular, Newest and Best deals tabs, and Network in the filter (n.516). | Why | source | - |

## Rulings

| Id | Date | Ruling | Scope | Source | Check | Status |
|---|---|---|---|---|---|---|
| U55 | 2026-11-09 | An action with a protocol-fee path in xchain-indexer shows the Fees card (Layout 1, ~/Pictures/wallet-protocol-fee-layouts.png). Revised 2026-11-12 (D4, G20): the form shows only the Form Standard's Network fee row (FeeSection), with the protocol fee in its summary and the pay-in-native-coin switch inside the opened row, and the Fees card appears only on the shared confirm screen as its cost card. The card is a Network fee row and a Protocol fee row, each with coin amount and fiat, and a Total row that reads one coin total plus fiat when the protocol fee is paid in the native coin ("0.00001697 BTC ~$1.11") and "0.000015 BTC + 0.064 XCHAIN ~$1.11" when it is paid in XCHAIN; fiat is always written "~$1.11", never "about", on every row. The actions with a protocol-fee path (verified in xchain-indexer src/actions, 2026-11-09) are AIRDROP, BATCH, BET, CALLBACK, DEPLOY (and chunks), DISPENSER, DIVIDEND, EXECUTE, ISSUE (new token only; any update to an existing token is free, issue/fees.js:78), LIST, ORDER, SWAP, SWEEP and XBRIDGE. Every other form (SEND, MINT, DESTROY, SLEEP, BROADCAST, FILE, LINK, ADDRESS, PRICE, token updates and the rest) shows only the plain Network fee row (U54) and never the pay-in-native switch or a protocol-fee line. On Litecoin and Dogecoin, where the native output is the protocol fee, the switch shows on and locked. | W X D M | source | none | binding |
| U100 | 2026-11-21 | No notice, banner, toast or prompt carries a "Dismiss" text button. Closing one is the standard Notice X in its top right corner (G120), the same X every notice uses; a second action button stays only when it does something other than close (for example "Remind me tomorrow" or "Discard draft"). Seen on the desktop update banner during the rr1121 walk (19885). |
| U47 | 2026-11-06 | Token detail quick actions (Send, Receive, Market view, History) are one horizontal row of compact buttons, never full-width list rows (reverts 273d88701 and 1fb795ce4). | W X D M | source | none | superseded by U76 |
| U101 | 2026-11-21 | When a notice lists more than one issue (the checks the network could not verify on Confirm, a form error summary, any list of problems), each issue is its own bullet in a bulleted list inside the notice, never stacked plain lines. Seen on the Confirm "Only partly checked" notice during the rr1121b walk (20066). | W X D M | source | none | superseded (Home Activity tab retired, n.253) |
| U102 | 2026-11-22 | A page title shows once. On the first-run licence page it is the boot page header's title (G109), so the card under the logo carries no "License Agreement" heading; the Add Wallet path, which has no page header, keeps it on the card. A screen's heading takes focus for screen readers but draws its focus box only for keyboard users, never on first load or after a click. Operator, installed extension popup; xchain-wallet 1389f7c97. | W X D M | source | none | proposed |
| U20 | 2026-10-13 | A layout or CSS batch lands only after a screenshot comparison. | process | source | none | binding |

## Process rulings

| Id | Date | Ruling | Source |
|---|---|---|---|
| P01 | 2026-10-23 | Work is admitted by memory and process budgets. | source |

## Proposed

| U999 | 2026-11-22 | This section is not parsed. |

## Superseded

| Text | Where it was | Replaced by |
|---|---|---|
| "U08 Accept and Continue at the bottom, terms take all remaining height" | U08 | U32 |
