const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const loopbackAddress = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function configuredOrigin() {
  const raw = process.env.SPEECH_COACH_ALLOWED_ORIGIN?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function trustedBrowserRequest(input: {
  host?: string;
  origin?: string;
  method?: string;
  protocol?: string;
  remoteAddress?: string;
}) {
  const host = input.host;
  if (!host) return false;
  if (input.remoteAddress && !loopbackAddress.has(input.remoteAddress)) return false;
  const method = input.method ?? "GET";
  const mutation = method !== "GET" && method !== "HEAD";
  const origin = input.origin;
  if (loopbackHost.test(host)) {
    const expected = `${input.protocol ?? "http:"}//${host}`;
    return mutation ? origin === expected : !origin || origin === expected;
  }
  const allowed = configuredOrigin();
  if (!allowed || host !== allowed.host) return false;
  return mutation ? origin === allowed.origin : !origin || origin === allowed.origin;
}

export function trustedFetchRequest(request: Request) {
  const url = new URL(request.url);
  return trustedBrowserRequest({
    host: request.headers.get("host") ?? undefined,
    origin: request.headers.get("origin") ?? undefined,
    method: request.method,
    protocol: url.protocol,
  });
}
