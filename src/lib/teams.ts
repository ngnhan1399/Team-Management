import type { CurrentUserContext } from "@/lib/auth";

export function normalizeTeamId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isLeader(context: Pick<CurrentUserContext, "user"> | null | undefined): boolean {
  return Boolean(context?.user.role === "admin" && context.user.isLeader);
}

export function getContextTeamId(context: CurrentUserContext | null | undefined): number | null {
  return normalizeTeamId(context?.user.teamId ?? context?.collaborator?.teamId ?? context?.team?.id ?? null);
}

export function canAccessTeam(
  context: CurrentUserContext | null | undefined,
  teamId: number | null | undefined
): boolean {
  const normalizedTeamId = normalizeTeamId(teamId);
  if (!normalizedTeamId) return false;
  if (isLeader(context)) return true;
  return getContextTeamId(context) === normalizedTeamId;
}

export function resolveScopedTeamId(
  context: CurrentUserContext | null | undefined,
  requestedTeamId?: unknown
): number | null {
  const normalizedRequestedTeamId = normalizeTeamId(requestedTeamId);
  if (isLeader(context)) {
    return normalizedRequestedTeamId ?? getContextTeamId(context);
  }

  return getContextTeamId(context);
}
