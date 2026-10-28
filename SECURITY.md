# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/GustavoHSCruz/distopic-client/security/advisories/new)
and include the affected version, impact and steps to reproduce. You will get an
answer within a few days.

## How updates reach users

The client checks for updates on launch and every 6 hours.

- **Regular releases are never forced.** Users see a banner with *Update* and
  *Later*. Nothing downloads until they choose to, and a downloaded update
  installs on the next restart.
- **Critical vulnerabilities are the exception.** When a critical advisory
  affects the running version, the update downloads right away and the app
  blocks until the user restarts into the fixed version.

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
      "url": "https://github.com/GustavoHSCruz/distopic-client/security/advisories/GHSA-xxxx"
    }
  ]
}
```

Only `"severity": "critical"` entries make an update mandatory, and only for
versions lower than `fixedIn`. Publish the fixed release first, then add the
advisory. If the advisory file can't be fetched, updates stay optional: the
client never forces an update it can't justify.
