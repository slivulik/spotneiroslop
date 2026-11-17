/**
 * Where to go after sign-in: only a path on this site. The value is resolved the way a browser
 * would (it treats "\\" as "/" and drops tabs and line breaks), so "/\\evil.example" or
 * "/<TAB>/evil.example" cannot smuggle another origin past a prefix check.
 */
export function safeNext(value: string | null, origin: string): string {
  if (!value || !value.startsWith("/")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
