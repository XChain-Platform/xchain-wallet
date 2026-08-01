# XChain Wallet - Documentation

This directory hosts architecture docs, the dApp-bridge specification, contributor guides, and any other in-repo documentation as implementation proceeds.

For the authoritative design specification, see the `SPEC.md` document maintained under the parent XChain Platform repository at `claude/reports/xchain-wallet/SPEC.md`.

## Planned contents

- `ARCHITECTURE.md` - repo layout, package boundaries, state flow (from spec §9)
- `BRIDGE.md` - full `window.xchain` API reference (from spec §43, mirrored for dApp developers)
- `DEPENDENCIES.md` - per-package "why we depend on this" (from spec §9.7)
- `Reproducible_Builds.md` - build verification guide (from spec §51.4)
- `Verify_Release.md` - artifact signature verification (from spec §55.2)
- `QA_Checklist.md` - per-phase manual QA checklist (from spec §52.8)
- `Data_Collection.md` - what the wallet does and does not collect; the single source every store form transcribes ( §6c)
- `Privacy_Policy.md` - the plain-language rendering of the above, for publication at a stable xchain.io URL
- `Export_Compliance.md` - the encryption stance for store submissions

These land as the corresponding implementations land.
