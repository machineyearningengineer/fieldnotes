import { getVercelOidcToken } from "@vercel/oidc";
let cached: { value: string; until: number } | undefined;
let pending: Promise<string> | undefined;
export async function cloudIdentity(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const audience = process.env.GCP_FEDERATION_AUDIENCE;
    const account = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
    const target = process.env.API_ORIGIN;
    if (!audience || !account || !target) throw new Error("Cloud configuration missing");
    const oidc = await getVercelOidcToken();
    const response = await fetch("https://sts.googleapis.com/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        audience,
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        scope: "https://www.googleapis.com/auth/cloud-platform",
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: oidc,
      }),
    });
    if (!response.ok) throw new Error("Federated identity exchange failed");
    const exchanged = (await response.json()) as { access_token?: string };
    if (!exchanged.access_token) throw new Error("Federated identity unavailable");
    const result = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateIdToken`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.access_token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ audience: target, includeEmail: true }),
      },
    );
    if (!result.ok) throw new Error("Service identity exchange failed");
    const identity = (await result.json()) as { token?: string };
    if (!identity.token) throw new Error("Service identity unavailable");
    cached = { value: identity.token, until: Date.now() + 45 * 60_000 };
    return identity.token;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
