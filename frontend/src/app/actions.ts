"use server";

import { cookies } from "next/headers";
import { SignJWT, exportJWK, importJWK, JWK } from "jose";
import { encrypt, decrypt } from "./lib/session";

// Define a simple key pair generator using Node.js Web Crypto API
async function getOrCreateKeyPair(): Promise<{
  privateKey: CryptoKey | Uint8Array;
  jwk: JWK;
}> {
  const cookieStore = await cookies();
  const existingKeyStr = cookieStore.get("dpop_key")?.value;

  if (existingKeyStr) {
    try {
      const decryptedKey = await decrypt(existingKeyStr);
      const jwk = JSON.parse(decryptedKey) as JWK;
      // We must specify the parameters for ECDSA P-256 for importJWK
      const privateKey = await importJWK(jwk, "ES256");
      return { privateKey, jwk };
    } catch {
      // Fallback to regenerate
    }
  }

  // Generate new
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const jwk = await exportJWK(keyPair.privateKey); // export private key for storage!
  // Encrypt the private key before storing in a cookie — even if copied, it's
  // useless without the server's COOKIE_SECRET.
  const encryptedKey = await encrypt(JSON.stringify(jwk));
  cookieStore.set("dpop_key", encryptedKey, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });

  return {
    privateKey: keyPair.privateKey,
    jwk: await exportJWK(keyPair.publicKey),
  };
}

// Generate DPoP proof on the server
async function createProof(
  privateKey: CryptoKey | Uint8Array,
  publicKeyJwk: JWK,
  method: string,
  url: string,
): Promise<string> {
  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);

  // We only transmit the public part in the proof header
  const publicJwk = {
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  };

  const proof = await new SignJWT({
    jti: jti,
    htm: method,
    htu: url,
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk })
    .setIssuedAt(iat)
    .sign(privateKey as CryptoKey | Uint8Array);

  return proof;
}

/**
 * A wrapper around `fetch` that automatically generates and attaches a short-lived
 * DPoP proof for the specific URL and Method being requested. This ensures that EVERY 
 * request to the backend is cryptographically tracked to this specific device,
 * regardless of whether the user is logged in or not.
 */
async function backendFetch(url: string, options: RequestInit = {}) {
  // Always get or create the device keypair
  const { privateKey, jwk } = await getOrCreateKeyPair();
  const publicJwk = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  
  const method = (options.method || "GET").toUpperCase();
  const proof = await createProof(privateKey, publicJwk, method, url);

  const headers = new Headers(options.headers || {});
  headers.set("DPoP", proof);

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function loginAction() {
  const cookieStore = await cookies();
  // Clear any old session
  cookieStore.delete("dpop_token");
  cookieStore.delete("dpop_key");

  const url = "http://localhost:5083/api/auth/login";

  try {
    // backendFetch automatically generates the correct DPoP proof
    const res = await backendFetch(url, {
      method: "POST",
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const data = await res.json();

    // Encrypt and store access token in HttpOnly cookie
    const encryptedToken = await encrypt(data.access_token);
    cookieStore.set("dpop_token", encryptedToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });

    return {
      success: true,
      message:
        "Server securely acquired DPoP Token and stored in HttpOnly cookie.",
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchDataAction() {
  const cookieStore = await cookies();
  const encryptedToken = cookieStore.get("dpop_token")?.value;

  if (!encryptedToken) {
    return { success: false, error: "No active session. Please login." };
  }

  try {
    // Decrypt the cookie value using the server's secret
    const accessToken = await decrypt(encryptedToken);

    const url = "http://localhost:5083/weatherforecast";
    
    // backendFetch handles the DPoP proof generation seamlessly
    const res = await backendFetch(url, {
      method: "GET",
      headers: {
        Authorization: `DPoP ${accessToken}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchPublicDataAction() {
  const url = "http://localhost:5083/public-weather";

  try {
    // Calling backendFetch automatically ensures this device has a keypair 
    // and sends an authenticated DPoP tracking header.
    const res = await backendFetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
