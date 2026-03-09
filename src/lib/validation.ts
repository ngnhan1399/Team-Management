export class ValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function requiredString(value: unknown, fieldName: string, minLength = 1): string {
  const parsed = asString(value);
  if (!parsed || parsed.length < minLength) {
    throw new ValidationError(`${fieldName} is required`);
  }
  return parsed;
}

export function optionalString(value: unknown): string | undefined {
  const parsed = asString(value);
  return parsed ? parsed : undefined;
}

export function requiredInt(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${fieldName} must be an integer`);
  }
  return parsed;
}

export function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function enumValue<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): T {
  const parsed = asString(value) as T;
  if (!allowed.includes(parsed)) {
    throw new ValidationError(`${fieldName} is invalid`);
  }
  return parsed;
}

export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = asString(value) as T;
  return allowed.includes(parsed) ? parsed : undefined;
}
