# Community experience implementation

User scope, 2026-10-29. Client and companion server changes are developed on
`feat/community-experience`. Preserve the staged work from earlier requests.

- [x] Hide store entry points temporarily.
- [x] Settings preference cards, icons and effect descriptions.
- [x] Apple Music identity and current artwork.
- [x] Animated right-aligned call/channel actions and participant indicators.
- [x] Message sounds and persistent server/channel mute preferences.
- [x] Screen resolution/FPS selection and published quality labels.
- [x] Editor/project/file/language activity, with explicit sharing controls.
- [x] Configurable 10-minute automatic away status.
- [x] DM rail avatar/unread shortcuts.
- [x] Biography up to 1,000 characters with three-line profile preview.
- [x] Friend nicknames visible to both parties.
- [x] Private audio/video calls with ringing, accept/decline and cleanup.
- [x] Sent/received message feedback animations.
- [x] Login/register redesign and remembered account switching after logout.
- [x] Default call banner only over external service views.
- [x] Clean Annoy news/start destination.
- [x] Final tests: 17 desktop, 6 activity, 5 discovery and 2 profile tests; both typechecks and client build.
- [ ] Upstream fetch/integration, conflict review and PRs.

Git commit identity is configured globally and in both repositories as
GuilhermeSDB <guilhermescarmagnani@outlook.com>. Git Credential Manager and the
GitHub API verified the publication account as `guilhermeSDB`; the separate
connector still uses another account and is not used for publication.

Visual verification covered dark/light and minimum desktop width, registration,
settings and the connected private video panel. Impeccable reported zero
anti-patterns; type-size advisories retain the existing compact desktop scale.
Private video tests used deterministic generated media between two Electron
clients. Physical cameras, cross-network TURN and hardware-dependent 4K capture
remain deployment/manual checks.
