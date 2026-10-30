# Annoy

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron desktop client for Windows and Linux; React renderer, isolated preload and main process.

## Product Purpose

Connect to independently hosted Annoy instances, communicate through text, direct messages and voice, and access the official Discord in an isolated persistent view.

## Users

Inference from the repository and supplied reference: people participating in online communities, switching between servers, conversations and calls on desktop.

## Capabilities and Constraints

Preserve existing authentication, multiple accounts, relationships, server administration, permissions, uploads, voice/video, screen sharing, imports and updates. All interface copy is Brazilian Portuguese. Keep the renderer lightweight and share presentation primitives. The user authorized companion server changes for profile photos, search and private activity.

## Brand Commitments

The product is named Annoy. Preserve the upstream Annoy logo, amber/indigo identity, package metadata and repository ownership. The user requested familiar Discord-like interaction patterns with a distinct visual identity, an in-app image viewer and a custom window bar. Earlier Distopic naming and speech/D identity are superseded by the collaborator's upstream 0.3.1 rename, which the user explicitly requested preserving when preparing the PRs.

## Product Principles

- Keep conversations and voice within easy reach.
- Preserve real server content and permission behavior.
- Use consistent, accessible actions and feedback.
- Keep motion purposeful and the app responsive.

## Evidence on Hand

Existing renderer and protocol source, screenshots in docs/screenshots, and two user-supplied Discord interface references. No live account or server credentials were supplied.

## Confirmed Delivery Decisions

The user confirmed both dark and light themes and implementation directly in the running application. Preserve the current product workflows.

The user subsequently requested local personal colors, persisted resizable and
collapsible channel/member panels, latest-message navigation, blocking animated
connection recovery and more visible voice participation. Bot marketplace scope
was clarified as **Annoy servers**, with the necessary server support to be
defined. The client must never present Discord bots as directly compatible or
pretend that a local flag installs, stops or removes a server-side bot. See
`docs/bot-platform.md` for the proposed API/runtime boundary.

The latest refinement supersedes the left-panel collapse request: keep channels
open and use a single member-list button to toggle the right panel. Both panel
widths remain adjustable. Clarify rail destinations and voice/device actions.
Use shared animated Radix/shadcn-style selects and menus throughout, support
wheel image zoom and internal audio/video playback, and remember recent custom
colors. Settings edits require an explicit save and warn before discarding.
Profile photos support upload, removal and crop preview; the companion server
validates/re-encodes images and broadcasts profile updates. The server also
supports byte ranges for media seeking. Deployment remains separate from local
implementation and tests.

Further confirmed scope: searchable role/member selection, shared styled form
controls and async confirmations, server-backed message search with filters and
context navigation, and opt-in Windows detection of Steam games and music from
Spotify/Apple Music desktop sessions. Activity is ephemeral and delivered only
to mutual friends on each Annoy instance. Sharing a server or DM grants no
activity access; removing friendship immediately clears the visible activity.
One saved control enables game/music/editor sharing together, initially on, as requested
in the latest refinement. This expands
the companion server authorization to search and private activity delivery.

Settings use searchable sidebar categories with a shared explicit save/discard
flow. The voice strip is a compact single line and can be hidden in Barra e abas.
Keep one settings gear in the profile controls; clicking the identity opens an
upward profile card with current desktop activity. Attachment drafts show image,
video and audio previews with a non-wrapping file size. Voice controls use shared
sound feedback: disabling audio also mutes the microphone, and enabling audio
unmutes it.

The earlier brand destination to Annoy news is superseded: the first rail action
opens direct messages. News remains a separate footer action beside the add
entry point. Keep the rail compact, with unread DM shortcuts and server/service
tiles; omit duplicate Home labels and idle recent-DM clutter. The user requested
a white rounded logo background while preserving the Annoy silhouette and
amber/indigo artwork. Store entry points remain commented at user request. Preference cards explain effects. Server/channel mute preferences
suppress message sounds. Screen capture offers resolution/FPS and publishes the
selected quality. Automatic away defaults to ten minutes of system inactivity.

Social profiles include a 1,000-character biography and mutually visible friend
nicknames. Direct audio/video calls use authenticated friendship-scoped signaling
and WebRTC media. Account switching remembers signed-out account metadata only.
The companion server is authorized for these social and presence additions.

## Latest Confirmed Social and Media Scope

The latest user request supersedes the friend-only activity and disabled-store
scope above: opt-in activity is shared with friends and members of the same
server on an updated Annoy instance. A DM alone grants no access. Keep activity
ephemeral and clear it when the last qualifying relationship is lost. The bot
marketplace remains disabled; the new store manages local media packages.

Server search belongs in the right member-panel header, aligned with the
conversation header, with Ctrl+K retained. Starting a stream plays a distinct
room cue for everyone in that room, including the sender. Message-receive audio
plays only for recipients and respects mute preferences. Use recognizable
official service logos within the existing Annoy visual identity.

Profiles accept looping animated GIFs. Refreshed edit dialogs preserve explicit
save behavior; server editing includes image selection, preview and removal.
Messages support server-persisted emoji reactions. The composer offers emojis,
GIFs, stickers and a manageable local package store with install/remove,
image and JSON import, export, and visible attribution. Selecting local media
prepares a draft attachment; sending remains explicit. Package storage is local
to the device and does not imply account or server synchronization.

Online GIF search uses the official GIPHY API with visible attribution and a
configured public client key; it inserts GIF links rather than importing the
provider catalog. Local media remains usable without that key. This extends
the existing amber/indigo and warm-ivory world, shared controls and typography;
no replacement palette or type system was approved. See `docs/social-media.md`
for validation limits, provider configuration and the companion-server update
boundary. Local implementation and visual review do not establish deployment.

Message reactions are shared per message: show one emoji chip with a participant
count, let other users join the same emoji, and let each user toggle their own
participation. Preserve server-backed persistence and live updates. Quick emoji
actions and the picker complement chips displayed below message attachments.
