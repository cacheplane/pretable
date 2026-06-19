export function getVercelProtectionBypassHeaders(
  env: Record<string, string | undefined>,
) {
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  if (!bypassSecret) {
    return undefined;
  }

  // Send the bypass header alone. Playwright applies extraHTTPHeaders to every
  // request, so each one is authorized directly (200). Do NOT add
  // `x-vercel-set-bypass-cookie: true`: it makes Vercel answer with a 307 +
  // Set-Cookie (to seed the bypass cookie) instead of serving the page, which
  // breaks assertions on responses fetched with `maxRedirects: 0` (e.g. the
  // `Link: rel=llms-txt` header check).
  return {
    "x-vercel-protection-bypass": bypassSecret,
  };
}
