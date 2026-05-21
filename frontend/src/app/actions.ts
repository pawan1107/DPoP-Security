"use server";

import { cookies } from "next/headers";
import { encrypt, decrypt } from "./lib/session";

const API_URL = process.env.API_URL || "http://localhost:5083";

/**
 * A wrapper around `fetch` that attaches the short-lived DPoP proof
 * generated securely by the browser's hardware.
 */
async function backendFetch(url: string, options: RequestInit = {}, clientProof: string) {
  const headers = new Headers(options.headers || {});
  headers.set("DPoP", clientProof);
  headers.set("Content-Type", "application/json");

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function loginAction(clientProof: string) {
  const cookieStore = await cookies();
  // Clear any old session
  cookieStore.delete("dpop_token");

  const url = `${API_URL}/graphql`;
  const body = JSON.stringify({
    query: `
      mutation {
        login {
          accessToken
          tokenType
          expiresIn
          error
        }
      }
    `
  });

  try {
    // Pass the client's proof to the backend
    const res = await backendFetch(url, {
      method: "POST",
      body,
      cache: "no-store",
    }, clientProof);

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const json = await res.json();
    
    if (json.errors) {
       return { success: false, error: json.errors[0].message };
    }
    
    const data = json.data.login;
    if (data.error) {
       return { success: false, error: data.error };
    }

    // Encrypt and store access token in HttpOnly cookie
    const encryptedToken = await encrypt(data.accessToken);
    cookieStore.set("dpop_token", encryptedToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    });

    return {
      success: true,
      message:
        "Server securely acquired Access Token and stored in HttpOnly cookie.",
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchDataAction(clientProof: string) {
  const cookieStore = await cookies();
  const encryptedToken = cookieStore.get("dpop_token")?.value;

  if (!encryptedToken) {
    return { success: false, error: "No active session. Please login." };
  }

  try {
    // Decrypt the cookie value using the server's secret
    const accessToken = await decrypt(encryptedToken);

    const url = `${API_URL}/graphql`;
    const body = JSON.stringify({
      query: `
        query {
          weatherForecast {
            data {
              date
              temperatureC
              summary
            }
            device_ID
            dPoP_Valid
            dPoP_Error
          }
        }
      `
    });
    
    // Pass the client's proof for this specific GET request
    const res = await backendFetch(url, {
      method: "POST",
      headers: {
        Authorization: `DPoP ${accessToken}`,
      },
      body,
      cache: "no-store",
    }, clientProof);

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const json = await res.json();
    if (json.errors) {
       return { success: false, error: json.errors[0].message };
    }

    return { success: true, data: json.data.weatherForecast };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchPublicDataAction(clientProof: string) {
  const url = `${API_URL}/graphql`;
  const body = JSON.stringify({
    query: `
      query {
        publicWeather {
          data {
            date
            temperatureC
            summary
          }
          device_ID
          dPoP_Valid
          dPoP_Error
        }
      }
    `
  });

  try {
    // Pass the client's proof to cryptographically track the device
    const res = await backendFetch(url, {
      method: "POST",
      body,
      cache: "no-store",
    }, clientProof);

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const json = await res.json();
    if (json.errors) {
       return { success: false, error: json.errors[0].message };
    }

    return { success: true, data: json.data.publicWeather };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchCustomPublicDataAction(clientProof: string, queryName: string) {
  const url = `${API_URL}/graphql`;
  const body = JSON.stringify({
    query: `
      query {
        ${queryName} {
          data
          device_ID
          dPoP_Valid
          dPoP_Error
        }
      }
    `
  });

  try {
    const res = await backendFetch(url, {
      method: "POST",
      body,
      cache: "no-store",
    }, clientProof);

    if (!res.ok) {
      return { success: false, error: `${res.status} ${await res.text()}` };
    }

    const json = await res.json();
    if (json.errors) {
       return { success: false, error: json.errors[0].message };
    }

    return { success: true, data: json.data[queryName] };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
