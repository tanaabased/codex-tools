/** Identifies invalid source metadata in structured CLI failures. */
export interface SourceFailure {
  path: string;
  valid: false;
  issue: string;
}

/** Error shape used when filesystem codes or source diagnostics accompany a failure. */
export interface CodexToolsError extends Error {
  code?: string;
  source?: SourceFailure;
}

/** Normalizes thrown values before inspecting filesystem codes or public diagnostics. */
export function asError(value: unknown): CodexToolsError {
  return (value instanceof Error ? value : new Error(String(value))) as CodexToolsError;
}

export function hasErrorCode(value: unknown, ...codes: string[]): boolean {
  const code = asError(value).code;
  return code !== undefined && codes.includes(code);
}
