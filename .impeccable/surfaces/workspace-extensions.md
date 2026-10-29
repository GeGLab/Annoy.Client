# Desktop workspace extensions

Mode: Operate. Preserve the existing graphite/tangerine/ivory system. The user
requested behavior and configuration additions, not a new visual world.

- Community rail opens an instance-backed bot marketplace. Catalog and installed
  views are scoped to a server. Unsupported instances explain the missing server
  capability. No synthetic catalog ships. Installation reviews permissions;
  removal confirms scope; enabled intent is distinct from runtime health.
- A persistent voice strip identifies the current channel/server even with the
  channel panel collapsed or when reading text. Native Discord inset includes it.
- Channel/member separators support pointer, keyboard, reset and collapse; user
  preferences persist locally. The message area keeps usable width at 940px.
- Local accent and surface tint choices retain automatic text contrast across
  light/dark/system modes. Restoring defaults removes overrides.
- Returning to a conversation resets to latest, including clicking the already
  open channel. Incoming messages do not move a reader examining older history.
- Reconnection traps focus, hides the native Discord view and blocks underlying
  content. Recovery controls stay available; expired sessions can authenticate.
  Reduced motion keeps progress understandable without decorative movement.

Tests use synthetic API data and a controlled WebSocket; live bot runtime and
voice media execution are outside this client-only validation.
