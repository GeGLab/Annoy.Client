import { computePermissions, type Channel, type Member, type ServerState } from "@distopic/protocol";

/** Mirrors the server's resolution; used only to decide which controls to show. */
export function channelPerms(state: ServerState, userId: string, channel: Channel): number {
  return computePermissions({
    ownerId: state.server.ownerId,
    userId,
    everyoneRoleId: state.server.id,
    roles: state.roles,
    memberRoleIds: state.members.find((m) => m.user.id === userId)?.roleIds ?? [],
    overwrites: channel.overwrites,
  });
}

/** Highest role position; the owner outranks everyone. */
export function rankOf(state: ServerState, userId: string): number {
  if (state.server.ownerId === userId) return Number.POSITIVE_INFINITY;
  const member = state.members.find((m) => m.user.id === userId);
  let top = 0;
  for (const role of state.roles) if (member?.roleIds.includes(role.id)) top = Math.max(top, role.position);
  return top;
}

export function memberColor(state: ServerState, member: Member): string | undefined {
  let best: { position: number; color: string } | undefined;
  for (const role of state.roles) {
    if (role.color && member.roleIds.includes(role.id) && (!best || role.position > best.position)) best = { position: role.position, color: role.color };
  }
  return best?.color;
}

export const displayNameOf = (member: Member) => member.nick || member.user.displayName;
