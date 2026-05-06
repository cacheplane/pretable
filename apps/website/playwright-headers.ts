export function getVercelProtectionBypassHeaders(
  env: Record<string, string | undefined>,
) {
  const bypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  if (!bypassSecret) {
    return undefined;
  }

  return {
    "x-vercel-protection-bypass": bypassSecret,
    "x-vercel-set-bypass-cookie": "true",
  };
}
