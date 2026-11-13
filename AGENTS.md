# Releases

- User requirement: every release must pass CI before publication.
- User requirement: release only AFTER its delivery PR has been merged into main. Approval and green PR checks come before the merge; validate the merged main revision before distributing its installers. Never publish an open PR or an unmerged release branch.
- Never publish, mark Latest, or enable distribution of a release while any CI validation for its source revision is failing, cancelled, queued or running.
- Require successful desktop-validation and security-validation on both Windows and Linux. Investigate failures and fix their cause; do not disable, delete or weaken tests to obtain green checks.
- Confirm the tested source revision matches the release contents. Build installers from that revision, verify both platform builds, and verify the signed update manifests and artifact hashes before publishing.
- Changes to the interface must include the intended layout and navigation, connected to real application data. A palette-only change does not deliver the requested redesign.
- Keep published version tags intact. Use the next version for corrections.
- User requirement: finish delivery PRs autonomously. Resolve conflicts, require green CI for the final revision, merge the PR and close superseded PRs without asking for another confirmation. Leave a PR unmerged only when explicitly requested or when an actual external blocker prevents completion; explain that blocker.

- Releases must be automatic and only AFTER the delivery PR is merged into the default main/master branch and its merged source passes CI. Never publish an open PR or reuse a published release branch for new work.
