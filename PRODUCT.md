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
Separate saved controls enable game/music sharing, initially off. This expands
the companion server authorization to search and private activity delivery.
