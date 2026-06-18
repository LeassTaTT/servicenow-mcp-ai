import { createSign } from "node:crypto";

/**
 * Minimal RS256 JWS signer for the OAuth 2.0 JWT-bearer grant
 * (`urn:ietf:params:oauth:grant-type:jwt-bearer`). Uses node:crypto only — no
 * dependency. The matching public certificate is registered on the ServiceNow
 * JWT provider.
 */

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sign a compact JWS (RS256). `payload` carries iss/sub/aud/iat/exp. */
export function signJwtRS256(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid?: string,
): string {
  const header: Record<string, unknown> = { alg: "RS256", typ: "JWT" };
  if (kid) header.kid = kid;
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${b64url(signer.sign(privateKeyPem))}`;
}
