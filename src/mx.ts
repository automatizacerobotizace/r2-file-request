export type MxResult = "ok" | "none" | "error";

interface DohResponse {
  Status: number;
  Answer?: { type: number; data: string }[];
}

export async function checkMx(domain: string, fetcher: typeof fetch): Promise<MxResult> {
  let res: Response;
  try {
    res = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
    });
  } catch {
    return "error";
  }
  if (!res.ok) return "error";
  let body: DohResponse;
  try {
    body = await res.json<DohResponse>();
  } catch {
    return "error";
  }
  if (body.Status === 3) return "none"; // NXDOMAIN
  if (body.Status !== 0) return "error";
  const mx = (body.Answer ?? []).filter((a) => a.type === 15);
  if (mx.length === 0) return "none";
  if (mx.every((a) => /^\d+\s+\.$/.test(a.data.trim()))) return "none"; // null MX (RFC 7505)
  return "ok";
}
