# Release CI: the settings that make `release.yml` safe

**Item:**  S4 (§5 signing-lane protection). **Audience:** whoever
administers the GitHub org.

`.github/workflows/release.yml` builds and signs release artifacts. On
its own, that file is not safe to run. The controls that make it safe
are **repository settings**, not YAML, and they must exist before the
workflow is ever run with real signing secrets.

⬜ Every step below is unconfigured until someone ticks it off here.

---

## Why this document exists rather than a comment in the workflow

The remotes are shared and a second coder pushes to them. A
tag-triggered workflow holding code-signing secrets is a
signed-malware factory: anyone who can push a `v*` tag can fire it.

The manual store-publish gate does not close this. The output of a
compromised run is a **properly signed, notarized, correctly named
binary**. It would pass every check a user can perform, and a user who
downloads directly from `downloads.xchain.io` never touches a store
gate at all. The store gate protects the store. These settings protect
the user.

Nothing in a workflow file can enforce any of this, because a workflow
file is editable by anyone who can push.

---

## 1. Create the `release-signing` environment

⬜ Settings → Environments → New environment → `release-signing`

⬜ **Required reviewers:** add the release maintainer. This is the whole
control. A job that names `environment: release-signing` cannot start,
and therefore cannot read a signing secret, until a human approves the
run. Approve only after checking that the tag points at the commit you
meant, on a run you expected.

⬜ **Deployment branches and tags:** restrict to the tag pattern `v*`.

⬜ Do NOT add yourself as a reviewer and then approve reflexively. The
approval prompt is the moment to look at the run, and it is the only
moment. Treat an unexpected release run the way you would treat an
unexpected password reset email.

## 2. Bind the signing secrets to that environment

⬜ Add every secret below under **the environment**, never under
repository secrets. A repository secret is readable by any workflow,
including one added in a pull request from a branch.

| Secret | Credential | Used by |
|---|---|---|
| `MACOS_CSC_LINK` | K3 Developer ID Application cert (base64 .p12) | `desktop-macos` |
| `MACOS_CSC_KEY_PASSWORD` | K3 cert passphrase | `desktop-macos` |
| `APPLE_API_KEY` | K4 App Store Connect API key (.p8) | notarization |
| `APPLE_API_KEY_ID` | K4 key id | notarization |
| `APPLE_API_ISSUER` | K4 issuer id | notarization |
| `APPLE_TEAM_ID` | K2 team id | notarization |
| `AZURE_TENANT_ID` | K6 Azure Trusted Signing (D3) | `desktop-windows` |
| `AZURE_CLIENT_ID` | K6 | `desktop-windows` |
| `AZURE_CLIENT_SECRET` | K6 | `desktop-windows` |
| `AZURE_CODE_SIGNING_NAME` | K6 account name | `desktop-windows` |
| `AZURE_CERT_PROFILE_NAME` | K6 certificate profile | `desktop-windows` |
| `AZURE_CODE_SIGNING_ENDPOINT` | K6 signing endpoint, region-specific | `desktop-windows` |
| `XCHAIN_STAGING_FEED_URL` | §7.5 rehearsal feed | all three desktop lanes |

⬜ **`AZURE_CODE_SIGNING_ENDPOINT` is not optional.** electron-builder's
`azureSignOptions` requires it and it cannot be defaulted, because it is
tied to the region the Trusted Signing account was created in. Without
it the build config falls back to the classic-cert path, so the Windows
lane produces **unsigned artifacts while appearing to be configured for
Azure signing**. It is the one Azure value whose absence is silent.

⬜ **`XCHAIN_STAGING_FEED_URL` must be ONE stable value, reused for every
release** ( §7.5). Each release's rehearsal build has it baked in
at build time, and the NEXT release's rehearsal needs that build to find
the new staging pointer. Rotating it per release orphans the chain.
Rotate only on suspicion of leak, and treat that as a planned migration.
Leave it unset and every rehearsal step is skipped; production builds
are unaffected either way.

⬜ Confirm the existing repository secret `XCHAIN_SDK_DEPLOY_KEY` (used
by `ci.yml`) stays a repository secret. It is read-only and unrelated;
moving it would break CI.

**These CI copies are caches, not the store of record.** The
maintainer's 0600 copy plus the recovery copy is authoritative (§4). If
a secret is lost here, it is re-uploaded from there, not recovered from
GitHub.

**K1 is not in this table and must never be.** The release manifest is
GPG-signed on the release machine. A runner that could sign the
manifest would make every path into the workflow a path to a signed
release.

## 3. Restrict who can create `v*` tags (tag protection)

GitHub calls this tag protection, configured through rulesets.

⬜ Settings → Rules → Rulesets → New ruleset, targeting **tags**,
pattern `v*`.

⬜ Restrict creation to the release maintainer. Everyone else with push
access can still push code and still cannot start a release.

⬜ Enable "Block force pushes" so a tag cannot be silently repointed at
a different commit after the run that built from it. Without this, the
run ID recorded in the release record stops proving anything: the tag
it names could now mean something else.

## 4. Keep signing secrets away from pull requests

⬜ Confirm `release.yml` triggers only on `push: tags: v*`. It does
today. Any future change adding `pull_request`, `workflow_dispatch`
without an environment, or `pull_request_target` to a workflow that can
read these secrets undoes section 1.

⬜ Settings → Actions → General → set "Fork pull request workflows from
outside collaborators" to require approval for **all external
collaborators**.

## 5. Verify it actually works

Do this once, before the first real release, and treat a surprise as a
finding rather than a nuisance.

⬜ Push a throwaway tag (for example `v0.0.0-cisetup.1`) from the
maintainer account. Confirm the run starts, `verify-tag` **fails**
because the tag does not match `package.json`, and no signing job ever
starts. That is the cheap gate working.

⬜ From a non-maintainer account with push access, attempt to create a
`v*` tag. It must be refused. If it is not, section 3 is not in force
and nothing else in this document matters.

⬜ On a real tag, confirm the signing jobs sit in "Waiting for
approval" and that no secret-bearing step has run before you approve.

⬜ After approval, confirm the run summary prints the run ID and head
SHA, and that nothing was published anywhere.

---

## What is deliberately NOT automated

- **Publishing.** No upload to `downloads.xchain.io`, no store
  submission. Humans push the final button in v1 (§7).
- **Manifest signing.** K1 never reaches a runner (§4).
- **Store review.** Asynchronous by nature; §2 accepts store-side lag
  and refuses artifact-side version skew.

The workflow's output is artifacts plus a run ID. Everything after that
is §6 steps 3 onward, on the release machine.
