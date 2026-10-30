import type { InstanceState } from "../../store.ts";
export function canViewActivity(instance: InstanceState | undefined, userId: string): boolean {
  return !!instance && (instance.user?.id === userId || instance.relationships.some((rel) => rel.user.id === userId && rel.status === "friend") || !!instance.instance?.groupActivity && (Object.hasOwn(instance.activities, userId) || Object.values(instance.serverStates).some((state) => state.members.some((member) => member.user.id === userId))));
}
