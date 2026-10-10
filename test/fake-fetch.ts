type Route = (req: Request) => Response | Promise<Response>;

export function fakeFetch(routes: Record<string, Route>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(req.url);
    const prefix = Object.keys(routes).find((p) => req.url.startsWith(p));
    if (!prefix) throw new Error(`fakeFetch: unexpected request to ${req.url}`);
    return routes[prefix]!(req);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

export const DOH = "https://cloudflare-dns.com/dns-query";
export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function dohAnswer(status: number, answers: { type: number; data: string }[] = []): Response {
  return Response.json({ Status: status, Answer: answers });
}
