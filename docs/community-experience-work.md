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
- [x] Final tests: 17 desktop, 7 activity, 5 discovery and 2 profile tests; both typechecks and client build.
- [x] Fetch/integrate client upstream 0.4.4 and server 0.4.3; resolve capture/settings conflicts.
- [x] Post-merge checks: 16 desktop passes plus the updated settings test passing separately, 7 activity and 7 server tests, typechecks and build.
- [x] Linked PR publication as guilhermeSDB: [client #2](https://github.com/GeGLab/annoy-client/pull/2), [server #2](https://github.com/GeGLab/annoy-server/pull/2).

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

Integration preserves upstream system audio, frame-rate/content hints, native
capture, uncapped FPS, Cloudflare stream budgets and call recovery. Old saved
FPS preferences migrate to the new resolution/FPS picker. New quality metadata
uses zero to label native/uncapped choices without imposing capture caps.

Follow-up: file-type artwork (including JSON), automatic away recovery independent
of server capability, persisted manual status with DND/invisible semantics, and
self activity/biography in the member list profile. Integrated upstream 0.5.0
(Annoy Global and account linking) without replacing its behavior. Verified both
types, client build, 18 desktop tests, 8 helper tests and 8 server tests. Upstream
Global integration tests skip because the separate Annoy-api-global checkout is
not available here.
