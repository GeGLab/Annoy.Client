# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/GeGLab/annoy-client/security/advisories/new)
and include the affected version, impact and steps to reproduce. You will get an
answer within a few days.

## How updates reach users

The client checks for updates on launch, on focus/resume, and every minute.

- **Regular releases are never forced.** Users see a banner with *Update* and
  *Later*. Nothing downloads until they choose to, and a downloaded update
  installs on the next restart.
- **Critical vulnerabilities are the exception.** When a critical advisory
  affects the running version, the update downloads right away and the app
  blocks while downloading, then installs and restarts automatically as soon as the verified installer is ready.

The mandatory rule is driven by [`security/advisories.json`](security/advisories.json)
on the `main` branch:

```json
{
  "advisories": [
    {
      "id": "DSA-2026-001",
      "severity": "critical",
      "fixedIn": "0.1.2",
      "summary": "One-line description users will see.",
      "url": "https://github.com/GeGLab/annoy-client/security/advisories/GHSA-xxxx"
    }
  ]
}
```

Only `"severity": "critical"` entries make an update mandatory, and only for
versions lower than `fixedIn`. Publish the fixed release first, then add the
advisory. If the advisory file cannot be fetched, a previously detected critical advisory remains blocking. With no known advisory, regular updates stay optional.


## Account policy security release (pending approval)

The account-mode update is a mandatory security release. Its public advisory
must be activated only after Gustavo explicitly approves publishing the release,
and after the verified Windows/Linux installers and update metadata are available.
No public advisory is activated by these source changes. See
[the pending release notes](security/ACCOUNT-MODE-RELEASE.md).

Detection is polling-based (up to one minute plus network/cache delay), so it
cannot promise instantaneous delivery. Existing 0.8.0 clients still use their
installed updater: a six-hour poll and a user-triggered restart. New source
cannot change an already installed binary before it updates. Unsupported
packages, offline clients and stopped applications cannot update themselves.

## Signed artifacts in the security implementation

The local security implementation requires an Ed25519 signed artifact manifest before an update becomes ready, and rechecks its hash before installation, including install on quit. Query/download and advisory mechanisms remain present. `src/main/update-trust.ts` intentionally has no production trust key yet: installation without a trusted signature fails closed. Old unsigned releases therefore need a manually verified bootstrap installer. No production key, signed release or new critical advisory was published. See the sibling `annoy-server/docs/security/UPDATE-SIGNING.md` for provisioning, rotation, tested cases and limitations; Authenticode and real Windows installation are not validated.
