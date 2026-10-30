---
name: "Annoy"
description: "Desktop conversations with familiar navigation, indigo and amber, and warm ivory light mode."
colors:
  dark-bg-rail: "#0a0912"
  dark-bg-channels: "#12111b"
  dark-bg-main: "#171621"
  dark-bg-elev: "#201e2c"
  dark-bg-hover: "#282535"
  dark-bg-active: "#322e42"
  dark-bg-input: "#1c1a27"
  dark-bg-deep: "#0e0d16"
  dark-border: "#2c2939"
  dark-border-strong: "#423c55"
  dark-text: "#f2f0f8"
  dark-text-soft: "#d1cde0"
  dark-text-muted: "#938ca8"
  dark-accent: "#ffb020"
  dark-accent-hover: "#ffc04d"
  dark-accent-strong: "#ffd27a"
  dark-accent-soft: "rgba(255, 176, 32, 0.14)"
  dark-accent-line: "rgba(255, 176, 32, 0.45)"
  dark-on-accent: "#1f1400"
  dark-link: "#ffc55c"
  dark-danger: "#f2554b"
  dark-ok: "#43c59e"
  dark-warn: "#ff8a3d"
  dark-mention: "rgba(255, 176, 32, 0.08)"
  light-bg-rail: "#e9e7e3"
  light-bg-channels: "#f2f1ee"
  light-bg-main: "#fcfbf9"
  light-bg-elev: "#eeece8"
  light-bg-hover: "#e7e4df"
  light-bg-active: "#dedbd5"
  light-bg-input: "#f3f1ed"
  light-bg-deep: "#e8e5df"
  light-border: "#dedbd5"
  light-border-strong: "#b6b0a7"
  light-text: "#282724"
  light-text-soft: "#484641"
  light-text-muted: "#6b655d"
  light-accent: "#8b5400"
  light-accent-hover: "#724300"
  light-accent-strong: "#805000"
  light-accent-soft: "#8b54000e"
  light-accent-line: "#8b540055"
  light-on-accent: "#ffffff"
  light-link: "#8b5400"
  light-danger: "#b72d3e"
  light-ok: "#157256"
  light-warn: "#855d12"
  light-mention: "#8b54000b"
typography:
  display:
    fontFamily: "\"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-.035em"
  headline:
    fontFamily: "\"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-.025em"
  title:
    fontFamily: "\"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    letterSpacing: "-.02em"
  body:
    fontFamily: "\"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "\"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: ".015em"
  mono:
    fontFamily: "\"JetBrains Mono\", ui-monospace, monospace"
    fontSize: ".88em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  theme-card: "10px"
  skeleton: "5px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.dark-accent-hover}"
    textColor: "{colors.dark-on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.dark-bg-elev}"
    textColor: "{colors.dark-text-soft}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.dark-bg-active}"
    textColor: "{colors.dark-text-soft}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.dark-text-muted}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.dark-bg-hover}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.dark-danger}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-destructive-hover:
    backgroundColor: "{colors.dark-danger}"
    textColor: "{colors.dark-bg-rail}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.dark-bg-hover}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "8px 15px"
    height: "36px"
  input:
    backgroundColor: "{colors.dark-bg-input}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: "38px"
  channel-active:
    backgroundColor: "{colors.dark-accent-soft}"
    textColor: "{colors.dark-accent-strong}"
    rounded: "{rounded.md}"
    padding: "7px 9px"
    height: "36px"
  voice-chip:
    textColor: "{colors.dark-ok}"
    padding: "6px 2px 11px"
  theme-card:
    backgroundColor: "{colors.dark-bg-input}"
    textColor: "{colors.dark-text-soft}"
    rounded: "{rounded.theme-card}"
    padding: "14px"
    height: "58px"
  skeleton:
    backgroundColor: "{colors.dark-bg-elev}"
    rounded: "{rounded.skeleton}"
---

# Design System: Annoy

## Overview

**Creative North Star: "The Listening Room"**

Annoy places community navigation and conversation in a compact desktop workspace. Familiar server, channel, message and member positions keep the product easy to read; deep indigo surfaces, amber controls and the supplied Annoy logo give it its own identity. Light mode uses warm ivory surfaces and a darker amber accent.

The interface uses calm tonal layers, disciplined spacing and brief state changes. Product workflows and server content stay real; all interface copy is Brazilian Portuguese. The official Discord view retains its own interface and theme.

**Key Characteristics:**

- Familiar desktop navigation with the supplied Annoy logo.
- Deep indigo dark mode and warm ivory light mode.
- Compact controls with generous message line height.
- Flat workspace planes; lifted dialogs and feedback.
- Shared, keyboard-accessible primitives and reduced-motion support.

This document records the delivered source. `PRODUCT.md` owns product truth; `.impeccable/surfaces/desktop.md` owns the desktop composition. `src/renderer/src/styles/tokens.css` and `styles/components.css` are the implementation sources. YAML above owns extracted primitive values; `.impeccable/design.json` contains extensions and framework-independent previews. Theme prefixes identify paired values, not separate product identities. Component frontmatter uses dark defaults; the same semantic roles resolve to the paired light values at runtime. Component height entries describe the implemented minimum height.

The collaborator-supplied upstream Annoy identity supersedes the earlier Distopic speech/D mark and graphite/tangerine palette. Preserve the current `src/renderer/src/assets/logo.svg`: the user-confirmed white rounded background retains the upstream silhouette, pale shell, dark outline and amber details. This supersedes the earlier multicolor background. The asset-specific white background remains white across themes and does not introduce an additional interface palette. User-facing branding is Annoy, with the lowercase `annoy.` wordmark. Existing internal identifiers such as `@distopic/protocol`, `window.distopic`, `distopic.*` storage keys and `distopic-worker-v1` remain compatibility contracts.

Workspace extensions retain this world. `.impeccable/surfaces/workspace-extensions.md` records their composition; `styles/workspace.css` and `styles/marketplace.css` supply the added presentation rules. Shared controls, media/settings and discovery use `styles/controls.css`, `styles/media-settings.css` and `styles/discovery.css`. These are extensions of the established world, not additional token systems.

## Colors

### Primary

Amber (`dark-accent`) highlights primary actions, active community tiles and the brand period. The paired darker amber light token (`light-accent`) preserves contrast on warm ivory. Hover and strong variants support interaction and selected text. `accent-soft`, `accent-line` and `mention` are translucent companion treatments; preserve the source alpha values. `on-accent` supplies foregrounds on solid primary fills, and `link` supplies inline links.

### Neutral

The dark theme progresses through deep indigo tones from the rail through channels and main conversation to elevated, hover and active surfaces. Light mode follows the same semantic ordering with warm stone and ivory. `bg-deep` anchors profile controls and media canvases. Use `text` for primary reading, `text-soft` for message prose and secondary controls, and `text-muted` for supporting metadata. `border` divides surfaces; `border-strong` supports outlines and scrollbars. No independent secondary brand accent is established.

### Status

`danger` identifies errors and destructive actions; `ok` identifies connected voice and positive state; `warn` marks pending or warning state. Pair color with text or an icon. Dark and light values are separate tokens, not opacity approximations of each other.

**The Semantic Palette Rule.** Use the semantic CSS variables or their Tailwind aliases in new UI; preserve dark, light and system theme behavior. Status colors communicate status, while amber marks selection and primary actions.

Personal appearance choices are local preferences, not additional fixed palette tokens. A selected surface color contributes a restrained tint (12%) to the theme's main neutral before deriving the panel layers. The selected accent is adjusted toward a readable foreground until it reaches a contrast ratio of (4.5:1) against the main surface; companion fills, links and on-accent text are derived from that result. Preserve these adjustments across light, dark and system theme changes. Restoring original colors removes the overrides.

## Typography

The interface uses the system Segoe stack in the normative typography tokens. No webfont download is required. Code uses the JetBrains Mono stack when available, falling back to the platform monospace face.

- **Display:** the first-run welcome heading; at the compact desktop breakpoint it reduces to (36px).
- **Headline:** conversation-start headings.
- **Title:** dialog headings; ordinary channel and chat headers stay compact (14px, weight 650).
- **Body:** message prose with relaxed line height; navigation uses (13px), and supporting metadata uses (10–12px).
- **Label:** category and field captions in sentence case. Modal field labels use (12px).
- **Mono:** inline code and preformatted content; timestamps and counters use tabular numbers.

The wordmark uses a compact, heavier system face (19px, weight 750, tracking -.035em), reduced to (14px) in the native titlebar. Avoid introducing a separate display font into ordinary product screens.

The observed interface scale also uses compact text (12px and 13px). Workspace additions retain these sizes, with a small voice-presence marker (9px), bot listing titles (15px), confirmation titles (21px), recovery headings (22px) and marketplace introductions (25px). These are observed component sizes, not a new global type scale.

**The Conversation First Rule.** Keep body copy readable and message history stable. Do not animate the arrival of the entire message history.

## Layout

The desktop frame consists of a draggable titlebar (36px high), a persistent community rail (76px wide), channel/DM navigation (252px default), a flexible conversation, and members on server channels (220px default). Navigation and chat headers share a (56px) height. The initial native window is (1320 × 840px), with a minimum width of (940px). This is a desktop layout, with no implemented phone navigation topology.

Channels resize between (220px and 380px); members resize between (180px and 340px). Their locally saved widths are requests: both panels share the available allocation and drag preview to retain at least (360px) for conversation at the minimum desktop width. Channels stay open. Only the right member panel collapses, through the single member-list button in the conversation header; its selected width is retained while hidden. Do not add a second collapse affordance or a collapsed channel strip. Separators have a pointer target (7px), keyboard steps (8px; 24px with Shift), Home/End bounds and double-click reset to the defaults. Persist widths on release and retain the member-panel visibility preference across restarts.

At widths up to (1100px), topic text is hidden and welcome padding tightens. At widths up to (960px), message side padding becomes (16px) and header controls tighten. Panel allocation replaces the former fixed responsive widths. Keep flexible children shrinkable with `min-width: 0`; long labels truncate or wrap where their content permits. Settings grids use shrinkable columns and selects constrained to their field width. Search filters move from three shrinkable columns to two at (1000px). Popovers must use the live trigger position, remain within available viewport height and scroll internally; resizing the window must not detach profile content from its trigger or push a calendar below the viewport.

Use the observed spacing steps in frontmatter as a recurring rhythm, not a requirement to round every existing measurement. Navigation rows have a minimum height of (36px); shared buttons match that target. Legacy icon controls include (32px) and compact exceptions; shared icon Buttons use (36px). Message prose uses an author gutter (38px), a content gap (12px), and wide-screen side padding (24px). The composer sits inside (20px) side margins.

Dialogs leave (24px) minimum side clearance. Standard dialogs cap at (460px); wide dialogs cap at (820px), with maximum height `calc(100dvh - 84px)` and a scrolling body. The image viewer caps at (1200 × 860px), constrained by `calc(100vw - 64px)` and `calc(100dvh - 100px)`. Keep controls visible while the inner media canvas scrolls.

Titlebar controls, including the search entry and its Ctrl+K hint, are outside the drag region. Window buttons are (44px) wide; the close control has its native red hover treatment. macOS retains native window controls. The (36px) titlebar and (76px) rail must stay synchronized with main-process constants because they position the isolated official Discord view.

## Elevation & Depth

Persistent columns are flat planes defined by background tones and fine borders. Rounded floating dialogs, tooltips and toasts carry shadows. There is no blur-based material system. Dialog backdrops start below the titlebar; titlebar controls remain visible.

### Shadow Vocabulary

- **Overlay:** `var(--shadow-overlay)`; dark and light resolve to their theme-specific values in the sidecar. Use for dialogs and the image viewer.
- **Tooltip:** (0 4px 16px #0003); small, local explanatory feedback.
- **Toast:** (0 8px 24px #0003); transient request feedback.
- **Shared control popover:** (0 12px 32px #0004); selects, action menus and color choices. Entity, calendar and profile popovers reuse the overlay shadow.

Dialog backdrop/content layers use (80/81), loading overlays (90), toasts (110) and tooltips (120). Connection recovery content uses (121) to stay above existing floating layers. Shared menus, selects, entity pickers and calendars use (100); unsaved-change content uses (105), and queued action confirmations use backdrop/content layers (150/151). Media menus must portal inside the active fullscreen element. Preserve this ordering and the correct portal container when composing overlays.

**The Workspace Plane Rule.** Separate persistent workspace columns with tonal surfaces and subtle borders. Reserve strong shadows for floating layers.

## Shapes

Controls use the medium radius; composer and popover containers use the large radius; standard dialogs use the extra-large radius. Theme cards use their own observed radius. The side rail uses compact icon destinations: outer controls are (44px) with (14px) corners and server tiles are (40px) with (12px) corners. Selected server tiles use accent fill and a slim rail-side indicator. The first direct-message control retains the white logo background. Tooltips and accessible names identify destinations without duplicate visible Home labels. Avatars use a softly squared face (35% radius). Image attachments clip their content (10px); the viewer uses (14px). Workspace columns remain largely square, with a softened upper-left navigation corner. Do not turn the main workspace into floating cards.

## Components

### Buttons

Use `Button` variants `default`, `secondary`, `ghost`, `destructive` and `outline`; sizes are `default`, `sm` and `icon`. Primary fills use accent/on-accent. Secondary controls use elevated surfaces. Ghost controls gain a hover surface; destructive controls start as a danger outline and fill on hover. Outline controls use the stronger neutral border. The small size uses a minimum height of (30px), padding (5px 10px) and type (.85rem).

Default buttons use (8px 15px) padding, an (8px) icon gap, (.93rem) type, weight (600), and an (18px) line height. Disabled buttons use opacity (.45) and a blocked cursor. `loading` adds a spinner, sets `aria-busy` and disables repeat activation. Shared buttons default to `type="button"`; forms explicitly choose submit behavior. Accessible labels name the action, especially for icon-only controls.

### Inputs / Fields

Use `Input`, `Textarea` and the shared `Field` label/hint wrapper. Text fields use semantic input surfaces, a subtle border, minimum height (38px) and padding (8px 10px); `Select` follows the same field language. Focus changes the border to accent and supplies an accent-line outline. Hints and placeholders use muted text. Show failures through clear error copy and existing request feedback; do not imply an unimplemented validation system. The composer has its own enclosing focus border and keeps its textarea outline internal to that shared boundary. Input and Textarea preserve native text editing, selection and form semantics; style their shared boundary rather than replacing their internals. The operating-system file picker remains native.

Use shared Radix `Checkbox`, `RadioGroup`, `Slider` and `Switch` for choices and ranges. Checked controls use accent, selected states have indicators, and disabled controls remain visibly unavailable. Match the control to the meaning: a radio group chooses one option, a switch enables a preference, and a slider adjusts a continuous value. Supply visible labels or descriptive accessible names.

### Selects, Menus and Color Choices

Use `Select` for form values and `DropdownMenu` for actions or device choices. Preserve Radix keyboard navigation, focus restoration, collision handling, scrolling bounds and portaled content. Selected options carry an indicator; destructive menu actions use danger. Keep a previously selected disconnected device readable as unavailable until the user chooses a replacement. Do not introduce native `<select>` controls or manually positioned action menus.

`ColorPicker` provides a color plane, HEX input, suggested swatches and up to twelve recent custom colors. Its Cancel action discards the pending color; "Usar cor" applies it to the settings draft and remembers the color. Saving the settings is still required to persist the preference. Suggested and recent swatches are personal choices, not additions to the brand palette.

### Permission Targets and Overrides

Use `EntityPicker` for role/member targets. Its grouped, searchable popover includes role colors or avatar/identity icons, display names and usernames, a selected check and an explicit customization indicator. Keep the chosen target and its group readable in the closed trigger. Search has a clear empty state; do not flatten this into an unsearchable select of ambiguous names.

`PermissionToggle` is one Radix radio group with three states in fixed order: deny, inherit, allow. X, minus and check icons reinforce the Portuguese labels "Negar", "Herdar" and "Permitir"; danger, neutral and positive color support meaning without carrying it alone. Preserve arrow-key selection and a distinct focus outline. Permission edits participate in the settings draft and guarded save flow.

### Settings Drafts and Profile Editing

Personal, server, role, channel and permission-override forms use explicit drafts with a floating save bar. Keep "Redefinir" and "Salvar alterações" visible above the scrolling body, with enough bottom padding to reach every field. Saving has a busy state; failures remain visible beside the save controls and retain the draft for retry. A failed request must not close the dialog or silently appear saved.

Guard tab changes, modal dismissal, application navigation and window exits while dirty. Offer "Continuar editando", "Descartar alterações" and "Salvar e continuar"; continue only after the chosen reset or successful asynchronous save. Use `SettingsGuard` and `useSettingsDraft` rather than recreating this behavior per screen. Connection and deletion actions retain their own explicit action flow. Live voice/device actions are immediate controls, distinct from editing a settings form.

Profile editing identifies the account/instance and previews the display name and avatar at profile and compact sizes. The lazy crop editor uses a square source and a softly squared (35%) preview mask consistent with avatars, with drag and zoom controls. Upload, crop application and removal update the draft; no photo mutation is sent before Save. PNG, JPEG and WebP files are supported up to (8 MiB). Preserve field/crop errors and visible save-bar request failures. Companion server validation, re-encoding and broadcast behavior are documented in `docs/development.md`; local implementation does not establish deployment.

### Navigation

The first rail action opens direct messages; unread DM shortcuts follow it, with server/service tiles in the central strip and add/news actions in the footer. Recent DMs without unread messages stay in the DM sidebar. Keep rail destinations identifiable through tooltips, accessible names and selection state. Community tile positions stay stable when badges appear. Active tiles use the solid accent, active channels use a translucent accent surface, and voice channel activity uses positive status color. Channel actions appear on hover and `focus-within`. Tooltips clarify rail actions after a short delay (300ms). Preserve semantic selection state and keyboard focus. Unread, selected and disconnected states must remain distinguishable.

### Message Reactions

Render shared emoji/count chips below message content and attachments, with (10px) top spacing and a wrapping (6px) gap. Chips use the input surface, subtle border, medium radius, minimum height (30px) and padding (3px 8px). A user's participation uses accent-soft fill, accent border and strong accent text; `aria-pressed` exposes the same state. Counts use tabular numbers (12px, weight 600). Clicking joins or leaves that emoji; participant names remain available in the title. Quick emoji actions and the shared picker support adding a reaction. Pending or unavailable reactions disable mutation.

### Chips / Cards / Containers

The voice chip is an inline status block with a positive dot, channel context and separator, not a generic decorative pill; connecting changes the dot to warning. Theme selection cards have an input surface, subtle border, hover reinforcement and accent selection treatment. Existing account rows, invite boxes and administration containers reuse semantic surfaces and modest corners rather than introducing a new card language. Mention chips use translucent accent and strong accent text.

### Voice and Conversation Position

A persistent voice strip (56px high) keeps connection state, channel/server context, available participant count, call navigation and a labeled leave action visible while another conversation is open. It uses a subtle positive-status surface and border, warning text while connecting, and danger for leaving. The isolated official Discord view reserves the same vertical inset while voice is active. A small channel marker identifies the current voice room without relying on color alone. The channel-side voice panel exposes real call navigation, leave, camera and screen-sharing actions with connected/permission states. Microphone and output controls have separate device menus, a system-default choice, selected-device indicators and a voice-settings action. Do not add inert decorative controls.

Opening or reselecting a conversation moves to its latest messages. New messages and delayed image growth follow the bottom only while the reader remains there; loading older history preserves reading position.

### Connection Recovery

When an account is not ready or the browser reports offline, application-level recovery blocks content, traps focus and hides the native Discord view. The dialog caps at (540px) with side clearance (24px), a scrolling height limit and explicit retry, reauthentication for expired sessions, and account-disconnection recovery. Outside clicks and Escape cannot bypass the blocked state. Paired accent rings pulse around the mark (2.4s, offset 1.2s); connecting voice rotates (1.5s). Reduced motion removes these animations while retaining status text and recovery controls.

### Bot Marketplace

The lazy-loaded marketplace uses the same main plane, semantic controls and server context. Catalog entries use channel-toned surfaces, modest borders and large corners (12px); the grid starts from (260px) columns with gaps (16px). Installed entries form divided rows. At widths up to (1000px), content and toolbar padding tighten. Installation reviews version, author and requested permissions; removal confirms server scope. Disabled intent and runtime health remain distinct.

The client implements capability discovery, validated DTOs and server requests; `docs/bot-platform.md` defines the proposed server API/runtime, which is not implemented in this client repository. Unsupported instances, empty catalogs and request errors have distinct states. Never populate a synthetic catalog or imply universal Discord bot compatibility. After an indeterminate mutation, lock further changes until a successful refresh; authorization failures also refresh permissions. Local preferences do not install, stop or remove bots, and simulated API tests do not establish live runtime success.

### Message Search

The titlebar search entry and Ctrl+K open the lazy search dialog. Keep the current instance/server scope visible. The query row leads, followed by optional person, channel, attachment/link and before/after date filters using shared selects and the Portuguese calendar. The calendar bounds its height to the space Radix reports and scrolls internally; both date fields must remain usable at the minimum desktop viewport.

Results are compact, full-width conversation rows with author avatar/name, timestamp, excerpt, destination and an open-context icon. Preserve initial guidance, loading, no-result, unsupported-instance and request-error states, plus explicit pagination. Selecting a result loads its surrounding conversation, highlights the destination and shows "Voltar às mais recentes". Do not treat a context jump as ordinary latest-message navigation or lose the reader's position. Search and attachment access are server-authorized; `docs/search-activity.md` records the contract and current syntax limits.

### Private Friend Activity

Activity extends existing friend and profile surfaces using a deep-toned compact card: game or headphones icon, provider caption, clipped title, and optional artist. Compact rows omit the provider caption to fit the friend list. Game links have explicit accessible names. A profile popover stays anchored to its live trigger after resize and scrolls within available space. Empty or unsupported detection stays empty.

Games and music have separate switches under "Atividade para amigos", both off initially and persisted only through the settings save flow. Only self and mutual friends may receive activity on each instance; a shared server or DM does not qualify. Keep activity out of public User/Member presentation data, clear it on unfriend/disconnect and do not turn ephemeral presence into a history or a public server-member badge.

The Windows main process detects Steam running games with matching installed-process paths and playing Spotify/Apple Music desktop WinRT sessions. Only sanitized metadata crosses the preload and reaches the server; paths, process/library inventories, service tokens and screenshots do not. Server state is memory-only with a (75s) TTL, with cleanup timing described in `docs/search-activity.md`. Local tests and captures do not verify deployment or an actual active game/music session.

### Dialogs, Focus and Feedback

Use Radix Dialog for focus containment, Escape dismissal and labeled dialog titles. The wrapper preserves the invoking element across lazy loading and restores focus when it closes. Dialog content itself has no decorative focus outline; interactive children keep their own visible focus. Buttons, links and keyboard-focusable rows use an accent outline (2px) with offset (3px). Fields use an accent-line outline (2px), offset (1px), and accent border.

Renderer confirmations and short text requests use the queued asynchronous `ActionDialogHost` with Radix AlertDialog: await `confirmAction` or `promptText`, and treat a cancelled prompt as `null`. Do not restore `window.confirm` or `window.prompt`. These app dialogs retain focus, labels and keyboard behavior; operating-system file selection remains native.

Use Radix tooltips for explanatory labels. Toasts report request outcomes. Loading states reuse the geometry of the replaced content: shared chat skeletons have avatar/name/line placeholders and an accessible loading status. Do not display fabricated messages while loading or before connection.

### In-app Image Viewer

Open attachment images in the lazy-loaded Radix dialog. The viewer presents the filename and file details above a deep-toned canvas, with count, previous/next controls, zoom and original link below it. Initially fit the source inside the viewport with (24px) clearance per edge, capped at natural size. Zoom runs from (1× to 4×) in (.5×) button/keyboard increments relative to that fit; pointer-wheel zoom changes smoothly around the pointer, prevents page scrolling and respects the same bounds; oversized media scrolls inside the canvas. Image changes reset zoom and loading state. Loading has a status indicator; failure has an alert and retry action.

Arrow keys move between images; plus/minus adjust zoom. Controls disable at bounds and while media is unavailable. Escape closes and restores focus to the attachment trigger. A brief opacity reveal accompanies opening or changing an image; controls and layout do not move the message history.

### In-app Audio and Video

Open supported audio/video attachments in the lazy internal player. Use a deep media stage, clear filename/context, shared seek and volume sliders, play/pause, mute, speed selection and video fullscreen controls. Show buffering and playback failures with retry/original-file recovery. Closing stops playback and releases the source. Format support follows Electron's available codecs; seeking also depends on server byte-range support.

Fullscreen contains the player and all of its floating controls. Pass the active fullscreen element as the speed Select portal container so its options remain visible and interactive. Keep the player within viewport bounds outside fullscreen and preserve keyboard focus/close behavior. Do not send supported attachment playback straight to an external player.

### Motion, Icons and Brand

Shared selects, menus, color choices, entity pickers and profile popovers enter in (160ms) and exit in (120ms), using a brief opacity/position/scale change. Reduced motion removes these transitions while retaining every state and control. State color transitions use (160ms); overlay content reveals use (160–180ms). The image canvas reveal uses Framer Motion (.18s), supplied through `LazyMotion`, `m` and a separate animation feature chunk. `MotionConfig` honors the user's reduced-motion preference, and the CSS reduced-motion query removes animations and transitions. Skeleton pulse lasts (1.6s); image-loading rotation lasts (1s). Animate feedback, not whole conversation histories.

Use named Lucide imports with the shared icon wrapper: default size (18px), stroke width (1.75), hidden from assistive technology when a control already has a label. Do not dynamically load the full icon catalog. The single brand source is the collaborator-supplied `src/renderer/src/assets/logo.svg`, preserved with its user-confirmed white rounded background, pale speech/robot silhouette, dark outline and amber details. `Brand.tsx` pairs it with the lowercase `annoy.` wordmark. `npm run brand:icons` generates versioned SVG, PNG and ICO outputs for desktop, installer and favicon use.

Tailwind v4 provides semantic utilities through the official Vite plugin; shadcn-style primitives use Radix, CVA and shared classes. Add new primitives under `components/ui` and preserve existing workflow styling in `styles/legacy.css`. `docs/development.md` records source structure, code-first decisions, native-window integration and the Electron installer workflow. Avoid a parallel token or component system.

## Do's and Don'ts

### Do:

- **Do** use shared UI primitives for text fields, choices, menus, permissions, dialogs and loading states.
- **Do** preserve visible focus, descriptive Portuguese action labels and keyboard dismissal with focus restoration.
- **Do** test both themes at the default desktop size and the minimum width of 940px, including settings, permission targets, both calendars, media fullscreen and anchored profiles.
- **Do** use the single SVG brand source and regenerate packaged icons with npm run brand:icons.
- **Do** keep motion brief, honor reduced motion and load optional interfaces on demand.
- **Do** preserve explicit settings saves, guarded exits and visible request failures.
- **Do** keep activity sharing configurable, ephemeral and limited to self and mutual friends. The single games/music control defaults on per the latest user request.

### Don't:

- **Don't** borrow the Discord mark or blurple palette for Annoy chrome.
- **Don't** substitute synthetic conversations or members for real first-run empty states.
- **Don't** hardcode new presentation colors outside the semantic palette.
- **Don't** replace workspace columns with a collection of floating cards.
- **Don't** expose Electron or styling implementation details in user-facing flows.
- **Don't** reintroduce channel collapse, duplicate member toggles or autosaving settings forms.
- **Don't** add native selects, browser confirm/prompt dialogs or separate unshared form controls.
- **Don't** infer activity access from a shared server/DM or populate activity when detection is unavailable.
