# Releases

- User requirement: every release must pass CI before publication.
- Never publish, mark Latest, or enable distribution of a release while any CI validation for its source revision is failing, cancelled, queued or running.
- Require successful desktop-validation and security-validation on both Windows and Linux. Investigate failures and fix their cause; do not disable, delete or weaken tests to obtain green checks.
- Confirm the tested source revision matches the release contents. Build installers from that revision, verify both platform builds, and verify the signed update manifests and artifact hashes before publishing.
- Changes to the interface must include the intended layout and navigation, connected to real application data. A palette-only change does not deliver the requested redesign.
- Keep published version tags intact. Use the next version for corrections.
