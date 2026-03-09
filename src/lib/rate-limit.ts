type RateLimitEntry = {
    attempts: number;
    resetAt: number;
    blockedUntil: number;
};

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;

function now() {
    return Date.now();
}

function cleanup(key: string, entry: RateLimitEntry) {
    if (entry.blockedUntil <= now() && entry.resetAt <= now()) {
        store.delete(key);
    }
}

export function checkRateLimit(key: string) {
    const entry = store.get(key);
    if (!entry) {
        return { allowed: true, retryAfterSeconds: 0 };
    }

    cleanup(key, entry);
    const active = store.get(key);
    if (!active) {
        return { allowed: true, retryAfterSeconds: 0 };
    }

    if (active.blockedUntil > now()) {
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil((active.blockedUntil - now()) / 1000),
        };
    }

    if (active.resetAt <= now()) {
        store.delete(key);
        return { allowed: true, retryAfterSeconds: 0 };
    }

    return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedAttempt(key: string) {
    const current = store.get(key);

    if (!current || current.resetAt <= now()) {
        store.set(key, {
            attempts: 1,
            resetAt: now() + WINDOW_MS,
            blockedUntil: 0,
        });
        return;
    }

    current.attempts += 1;

    if (current.attempts >= MAX_ATTEMPTS) {
        current.blockedUntil = now() + BLOCK_MS;
        current.attempts = 0;
        current.resetAt = now() + WINDOW_MS;
    }

    store.set(key, current);
}

export function clearRateLimit(key: string) {
    store.delete(key);
}
