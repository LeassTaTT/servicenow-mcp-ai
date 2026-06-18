import { randomBytes, createHash } from "node:crypto";

/**
 * PKCE (RFC 7636) helpers for the OAuth 2.1 Authorization Code flow. Pure and
 * dependency-free so the login flow stays testable.
 */

/** base64url without padding. */
function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PkcePair {
  /** The high-entropy secret sent on the token exchange. */
  verifier: string;
  /** S256(verifier), sent on the authorization request. */
  challenge: string;
  method: "S256";
}

/**
 * Create a PKCE verifier/challenge pair. 32 random bytes yield a 43-character
 * base64url verifier — within the RFC's 43–128 range — and an S256 challenge.
 */
export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** A random URL-safe `state` value for CSRF protection on the redirect. */
export function createState(): string {
  return base64url(randomBytes(16));
}
