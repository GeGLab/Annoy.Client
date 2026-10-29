# Desktop workspace extensions

Mode: Operate. Preserve the upstream Annoy amber/indigo identity and ivory light mode. The user
requested behavior and configuration additions, not a new visual world.

- Store entry points are temporarily commented at user request. The retained
  marketplace implementation is instance-backed. Catalog and installed
  views are scoped to a server. Unsupported instances explain the missing server
  capability. No synthetic catalog ships. Installation reviews permissions;
  removal confirms scope; enabled intent is distinct from runtime health.
- A 36px single-line voice strip identifies the current channel/server while
  reading text or navigating elsewhere. A saved Barra e abas preference hides
  it; the native Discord inset follows the remaining content area.
- Settings use searchable sidebar categories, independent content scrolling and
  shared save/discard controls. Voice settings group devices, input and testing.
  Keep the profile gear as the sole settings shortcut; identity opens an upward
  self-profile popover with current activity. One activity-sharing switch controls
  games, music and editor activity together and starts enabled. Activity visibility remains mutual
  friends only.
- Composer attachments occupy one horizontal strip of compact media previews.
  Names truncate while size and removal remain fixed; media object URLs are
  released on removal or sending. Failed previews retain the attachment details.
- Voice participants are indented under their channel; stable membership order
  survives speaking and media updates. Compact, labeled icons show mute, deafen,
  camera, screen and authorized music activity. Moderation lives in a menu and
  omits redundant mute actions. Joining/leaving plays a distinct cue locally and
  for existing room participants; changing rooms announces departure then entry.
  Short participant, connection, settings-category and pressed-control animations
  preserve feedback without reordering content and honor reduced motion.
- Activity cards pair official Spotify/Steam marks with uncropped album/game
  artwork in both themes. Windows session thumbnails are resized to bounded JPEG
  data; Steam artwork resolves by app ID through official store metadata, with a
  bounded cache and failure fallback. The server advertises activityArtwork so
  the client omits artwork when publishing to older strict gateways. Artwork
  remains ephemeral and friendship-scoped; the server limits its size and source.
- Channel/member separators support pointer, keyboard and reset. Channels remain
  open; only the member panel collapses through one header action. Preferences
  persist locally. The message area keeps usable width at 940px.
- Local accent and surface tint choices retain automatic text contrast across
  light/dark/system modes. Restoring defaults removes overrides.
- Returning to a conversation resets to latest, including clicking the already
  open channel. Incoming messages do not move a reader examining older history.
- Reconnection traps focus, hides the native Discord view and blocks underlying
  content. Recovery controls stay available; expired sessions can authenticate.
  Reduced motion keeps progress understandable without decorative movement.

- News, remembered-account authentication, profile biographies and private call
  invitations reuse the existing shell and dialog primitives. Generated P2P video
  is verified between two Electron clients; physical capture and cross-network
  TURN remain manual deployment checks.
- Message and unread feedback, right-aligned channel/participant action reveals
  and selected capture-quality labels retain the compact desktop density.
- Provider marks include Apple Music and code editors; activity artwork and
  sanitized project/file metadata retain the friendship visibility boundary.
- File activities put the file-type glyph in the large artwork position, keeping
  the editor mark by its name. Member popovers include self activity and biography.
- The self profile provides immediate, persisted manual status selection. Online
  enables OS-idle detection; explicit idle/DND/invisible remain until changed.
  DND suppresses incoming message/call alerts. Invisible hides published activity.
  The existing compact scale is retained, including the tiny DND minus glyph.

Tests use synthetic API data plus real gateway and peer-media integration.
Live bot runtime remains outside scope.
