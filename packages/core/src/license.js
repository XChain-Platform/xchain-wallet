// Cluster J FOLLOWUP 5 — full license text bundled at build time so the
// Settings → About panel's "Show full license" affordance can render it
// inline. The canonical text lives at the repo root in LICENSE.md;
// this constant must be kept in sync with that file. A future enhancement
// would be a Vite `?raw` import — but importing across package boundaries
// (LICENSE.md is at the wallet repo root, this file is in `packages/core`)
// is bundler-fragile, and the text changes rarely.
//
// Sync expectation: any edit to LICENSE.md should also update LICENSE_TEXT
// here. The licence-sync smoke pins the equality.

export const LICENSE_TEXT = `# DANKEST COMMUNITY LICENSE

**Copyright © 2026 Dankest, LLC**

Licensed under the **Apache License, Version 2.0** (the “Apache License”), with the following **Additional Terms and Conditions**, which supplement and, where inconsistent, supersede the Apache License.

A copy of the Apache License is available at:
<http://www.apache.org/licenses/LICENSE-2.0>

---

## 1. Attribution

Any distribution, modification, or use of this software must retain the following notice in the source code and any associated documentation:

> Based on XChain Platform by Dankest, LLC – https://dankest.llc

This attribution must be displayed prominently and must not be removed or altered.

---

## 2. Repackaging and Commercial Use Restrictions

a. You may **not** repackage, rebrand, or redistribute this software—or any substantial portion thereof—under a different name or as your own product without the **prior written consent** of Dankest, LLC.
b. You may **not** sell, sublicense, or offer the software as a standalone product or service for commercial gain without such written consent.

---

## 3. Modification and Redistribution

Any modifications you make to the software must be distributed under the same terms as this License, including these Additional Terms.

---

## 4. Network Use Clause

If you operate a modified version of this software to provide functionality to users over a network, you must make the complete corresponding source code of your modified version available to those users under this License.
The source code must be publicly accessible in a prominent and convenient manner (for example, via a public repository or direct download link).

---

## 5. Conflict Resolution

In the event of any conflict between the Apache License and these Additional Terms, these Additional Terms shall control, but only to the extent necessary to give effect to the restrictions and conditions stated herein.

---

### END OF LICENSE
`;
