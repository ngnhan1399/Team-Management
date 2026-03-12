type CollaboratorDisplayOverride = {
  preferredName?: string | null;
  preferredPenName?: string | null;
  aliases: string[];
};

const KNOWN_COLLABORATOR_DISPLAY_OVERRIDES: CollaboratorDisplayOverride[] = [
  {
    preferredName: "Đậu Thị Phương",
    preferredPenName: "Thị Phương",
    aliases: ["Đậu Thị Phương", "Đậu Phương", "Thị Phương"],
  },
];

export function foldCollaboratorIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[@._-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISPLAY_OVERRIDE_LOOKUP = new Map<string, CollaboratorDisplayOverride>();
for (const entry of KNOWN_COLLABORATOR_DISPLAY_OVERRIDES) {
  const values = [entry.preferredName, entry.preferredPenName, ...entry.aliases];
  for (const value of values) {
    const folded = foldCollaboratorIdentity(value);
    if (folded && !DISPLAY_OVERRIDE_LOOKUP.has(folded)) {
      DISPLAY_OVERRIDE_LOOKUP.set(folded, entry);
    }
  }
}

export function buildCollaboratorIdentityVariants(value: unknown): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const variants = new Set<string>();
  const base = foldCollaboratorIdentity(raw);
  if (!base) return [];

  variants.add(base);

  if (raw.includes("@")) {
    const [localPart] = raw.split("@");
    const localVariant = foldCollaboratorIdentity(localPart);
    if (localVariant) {
      variants.add(localVariant);
    }
  }

  const tokens = base.split(" ").filter(Boolean);

  if (tokens.length >= 2) {
    variants.add(tokens.slice(-2).join(" "));
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }

  return Array.from(variants);
}

export function resolveCollaboratorDisplayOverride(values: unknown[]): CollaboratorDisplayOverride | null {
  for (const value of values) {
    const folded = foldCollaboratorIdentity(value);
    if (!folded) continue;

    const directMatch = DISPLAY_OVERRIDE_LOOKUP.get(folded);
    if (directMatch) return directMatch;

    const variants = buildCollaboratorIdentityVariants(value);
    for (const variant of variants) {
      const variantMatch = DISPLAY_OVERRIDE_LOOKUP.get(variant);
      if (variantMatch) return variantMatch;
    }
  }

  return null;
}

export function expandCollaboratorIdentityValues(values: unknown[]): string[] {
  const seen = new Set<string>();
  const expanded: string[] = [];

  const pushValue = (value: unknown) => {
    const raw = String(value || "").trim();
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    expanded.push(raw);
  };

  for (const value of values) {
    pushValue(value);
  }

  const override = resolveCollaboratorDisplayOverride(values);
  if (!override) return expanded;

  pushValue(override.preferredName);
  pushValue(override.preferredPenName);
  for (const alias of override.aliases) {
    pushValue(alias);
  }

  return expanded;
}

export function resolvePreferredCollaboratorName(values: unknown[], fallback?: string | null) {
  return resolveCollaboratorDisplayOverride(values)?.preferredName ?? fallback ?? null;
}

export function resolvePreferredCollaboratorPenName(values: unknown[], fallback?: string | null) {
  return resolveCollaboratorDisplayOverride(values)?.preferredPenName ?? fallback ?? null;
}
