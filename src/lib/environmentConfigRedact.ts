/** Redact sensitive values from environment config blobs before storage/display. */

export type CriblEnvironmentConfig = Record<string, unknown>

const SENSITIVE_KEY = /password|secret|token|apikey|api_key|privatekey|private_key|credential/i

const REDACTED = '••••••••'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** Deep-clone and mask sensitive keys in nested config objects. */
export function redactEnvironmentConfig<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactEnvironmentConfig(item)) as T
  }
  if (!isRecord(value)) {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (shouldRedactKey(k) && v != null && v !== '') {
      out[k] = REDACTED
    } else if (isRecord(v) || Array.isArray(v)) {
      out[k] = redactEnvironmentConfig(v)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export function configFromRecord(cfg: Record<string, unknown>): CriblEnvironmentConfig {
  return redactEnvironmentConfig({ ...cfg })
}
