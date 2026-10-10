export async function verifyTurnstile(token: string, secret: string, fetcher: typeof fetch): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  try {
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    if (!res.ok) return false;
    const data = await res.json<{ success?: boolean }>();
    return data.success === true;
  } catch {
    return false;
  }
}
