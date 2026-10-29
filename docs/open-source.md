# Open source, attribution and source delivery — IPM-24

It’s a Plan Mobile and its server/gateway integration are licensed
**AGPL-3.0-only**. The complete license text is [LICENSE](../LICENSE).
Source: <https://github.com/furkanmeclis/itsaplan-mobile>.
Upstream: <https://github.com/croffasia/itsaplan>, integration revision
`73aadf9945ec4c8a23c749fb4f4dee25b036acb3`. Upstream source/license notices and
third-party package licenses remain applicable. This document does not relicense
those components or assert rights beyond their original licenses.

The account-entry/account-settings screen links to the public source, AGPL text,
this document and the upstream project. CI builds embed their validated 40-character
GitHub source revision and link directly to that commit and its source archive;
local builds without a revision explicitly show a repository link instead.
Forks must update `sourceRepository` in `src/domain/source.ts` to their public
corresponding source before distributing a modified build. A repository link to `main` is a way to
find source, not a claim that its latest commit matches every distributed binary.
For each distributed binary, retain the exact source revision and corresponding
build instructions, dependency locks, modifications and required notices. The
PR/CI run links identify the tested revision; download source for that revision
from GitHub's commit archive. A modified self-host deployment must address AGPL
network source-access requirements as well as any binary distribution conditions.

## Reproducible evidence

After clean installs in the root and `services/push`, run `npm run licenses:report`.
`dist/licenses` contains:

- `npm-license-inventory.json`: scope, name, locked version, SPDX metadata,
  direct/development flags, original notice filenames and explicit warnings.
- `NPM-NOTICES.txt`: original top-level LICENSE/COPYING/NOTICE/UNLICENSE texts
  from installed packages, without removing their copyright/license statements.
- `PROJECT-LICENSE.txt`: an unmodified copy of the project's AGPL text.

The collector checks real paths and refuses notice symlinks escaping their
package. Missing optional platform packages, missing license metadata, absent
top-level notices and files over its size bound remain visible as warnings.
A package-manager license field does not replace the license text. Installed
platforms can produce different notice availability with the same lockfiles.

The Mobile CI additionally retains:

- `mobile-npm-license-evidence`: npm inventory and original notices.
- `mobile-android-dependency-evidence`: Gradle's resolved release runtime tree.
- `mobile-ios-license-evidence`: Podfile.lock and generated CocoaPods original
  acknowledgement files, including native dependency notice texts.

These are review aids, not a complete binary SBOM or a legal approval. Retention
is 90 days; CI artifacts alone are not a durable source/notice offer. Before
public distribution, archive the exact source/notices with the release, resolve
missing notices, check Gradle/AAR/native/CocoaPods requirements, and include the
required notices with the binary. The in-app links do not replace those steps.

## Scope still requiring review

Some transitive dependencies have obligations beyond an MIT notice, including
MPL-2.0 source conditions, CC-BY attribution and Apache notices. The inventory
makes these reviewable; it does not interpret every dependency's distribution
conditions. Match the final Android/iOS binary and server images, not only npm.
No pricing, managed-service contract, trademark authorization or store release
decision is made by this implementation. IPM-24 stays open until its remaining
native-notice/source-delivery review is completed.
