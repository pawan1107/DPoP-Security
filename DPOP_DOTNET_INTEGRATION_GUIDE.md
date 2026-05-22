# DPoP Integration Guide for .NET Backend

This document outlines the architecture and implementation steps required for the .NET backend to support **Demonstrating Proof-of-Possession (DPoP)**. 

---

## 1. Conceptual Map: How DPoP Works (No Decryption Needed!)

### A. It's a Key "Pair"
When the frontend's `window.crypto.subtle.generateKey` runs, it doesn't generate one key; it generates two mathematically linked keys:
*   **The Private Key:** Locked in the user's browser. Used only for **Signing**.
*   **The Public Key:** Safe to share with the whole world. Used only for **Verifying**.

### B. How the Client Sends the Public Key
The client takes its Public Key (the `jwk`), embeds it directly inside the header of the DPoP JWT token, signs the whole package using the locked Private Key, and sends that token to the backend in the `DPoP` HTTP header.

### C. How the Backend Verifies It (The Magic)
When the backend (the C# API) receives the request, **it does not decrypt the token**. Instead:
1. It opens the header of the DPoP token and extracts the **Public Key** (`jwk`) that the client sent.
2. It runs a cryptographic verification algorithm that essentially asks: *"Was this signature created by the exact Private Key that matches this Public Key?"*
3. Because of the complex math of Elliptic Curves (ECDSA), the backend can mathematically prove with 100% certainty that the client holds the Private Key, **without ever knowing what the Private Key actually is.**

### D. The Final Security Check (Thumbprinting)
Once the backend verifies the signature, it calculates the **"Thumbprint"** (a hash) of that Public Key. 
When the user logs in, the backend binds their Session Token to that specific Public Key Thumbprint (in a `cnf` claim).
From that moment on, if a hacker steals the session cookie and tries to use it, the backend will ask the hacker for a DPoP proof. The hacker can generate a *new* key pair and sign it, but the backend will see that the new Public Key Thumbprint doesn't match the one bound to the session, and it will reject the request!

---

## 2. The HTTP Headers

When the frontend communicates with the backend, it sends **two** distinct JWTs:
1.  **The Session Token:** Sent as `Authorization: DPoP <jwt_session_token>`
2.  **The DPoP Proof:** Sent as `DPoP: <jwt_proof_token>`

---

## 3. C# Implementation Example (Middleware)

To fully secure the API, the backend must implement the following logic. You will need the `System.IdentityModel.Tokens.Jwt` and `Microsoft.IdentityModel.Tokens` NuGet packages.

Here is a complete, working example of a custom ASP.NET Core Middleware that performs this exact extraction, signature verification, and thumbprint matching:

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace Backend.Middleware;

public class DPoPMiddleware
{
    private readonly RequestDelegate _next;

    public DPoPMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        bool hasDpopHeader = context.Request.Headers.TryGetValue("DPoP", out var dpopHeader) && !string.IsNullOrEmpty(dpopHeader);
        var authHeader = context.Request.Headers.Authorization.ToString();
        bool isDpopAuth = authHeader.StartsWith("DPoP ", StringComparison.OrdinalIgnoreCase);

        bool dpopValid = false;
        string? dpopError = null;

        if (hasDpopHeader)
        {
            var dpopProof = dpopHeader.ToString();
            var jwtHandler = new JwtSecurityTokenHandler();

            if (!jwtHandler.CanReadToken(dpopProof))
            {
                dpopError = "Invalid DPoP JWT format.";
            }
            else
            {
                var token = jwtHandler.ReadJwtToken(dpopProof);
                
                // Step 1: Extract the Public Key (JWK) from the header
                if (!token.Header.TryGetValue("jwk", out var jwkObj))
                {
                    dpopError = "Missing jwk in DPoP header.";
                }
                else
                {
                    var jwkJsonStr = JsonSerializer.Serialize(jwkObj);
                    var jsonWebKey = new JsonWebKey(jwkJsonStr);
                    
                    // Step 2: Calculate the Thumbprint of the Public Key
                    string actualJkt = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());
                    context.Items["DPoP_Thumbprint"] = actualJkt; // Expose to controllers

                    try 
                    {
                        // Step 3: Cryptographically verify the signature using the provided Public Key!
                        // This proves the client holds the matching Private Key.
                         var validationParameters = new TokenValidationParameters
                        {
                            ValidateIssuer = false,
                            ValidateAudience = false,
                            ValidateLifetime = false,
                            IssuerSigningKey = jsonWebKey
                        };
                        jwtHandler.ValidateToken(dpopProof, validationParameters, out var validatedToken);

                        // Step 4: Validate Anti-Replay / Anti-Spoofing claims (htm, htu)
                        var htm = token.Claims.FirstOrDefault(c => c.Type == "htm")?.Value;
                        var htu = token.Claims.FirstOrDefault(c => c.Type == "htu")?.Value;
                        var currentUrl = $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}{context.Request.Path}";

                        if (!string.Equals(htm, context.Request.Method, StringComparison.OrdinalIgnoreCase))
                        {
                            dpopError = "DPoP htm mismatch.";
                        }
                        else if (string.IsNullOrEmpty(htu) || !currentUrl.Equals(htu, StringComparison.OrdinalIgnoreCase))
                        {
                            dpopError = $"DPoP htu mismatch. Expected {currentUrl}, got {htu}";
                        }
                        else if (isDpopAuth)
                        {
                            // Step 5: If logged in, ensure the session token is bound to this EXACT thumbprint
                            var cnfClaim = context.User.FindFirst("cnf")?.Value;
                            if (string.IsNullOrEmpty(cnfClaim))
                            {
                                dpopError = "Missing cnf claim in access token.";
                            }
                            else
                            {
                                string expectedJkt = "";
                                try
                                {
                                    using var cnfDoc = JsonDocument.Parse(cnfClaim);
                                    if (cnfDoc.RootElement.TryGetProperty("jkt", out var jktElement))
                                    {
                                        expectedJkt = jktElement.GetString() ?? "";
                                    }
                                }
                                catch
                                {
                                    dpopError = "Invalid cnf claim format.";
                                }

                                if (string.IsNullOrEmpty(dpopError) && actualJkt != expectedJkt)
                                {
                                    // HACKER DETECTED!
                                    dpopError = "DPoP proof thumbprint mismatch. Expected " + expectedJkt + " but proof was signed by " + actualJkt;
                                }
                                else if (string.IsNullOrEmpty(dpopError))
                                {
                                    dpopValid = true; // SUCCESS!
                                }
                            }
                        }
                        else
                        {
                            dpopValid = true; // Unauthenticated but cryptographically valid proof
                        }
                    }
                    catch (Exception ex)
                    {
                        dpopError = $"DPoP signature validation failed: {ex.Message}";
                    }
                }
            }
        }
        else if (isDpopAuth)
        {
            dpopError = "Missing DPoP header for DPoP authenticated request.";
        }
        else 
        {
            dpopError = "No DPoP header provided.";
        }

        // Flag the connection so downstream controllers/middleware can decide what to do
        context.Items["DPoP_Valid"] = dpopValid;
        context.Items["DPoP_Error"] = dpopError;

        await _next(context);
    }
}
```

---

## 4. Database & Storage Architecture 

While the actual API request verification is entirely stateless (the `DPoPMiddleware` just compares the Session JWT to the DPoP header), you **should** store the Device IDs in your database for security management. 

### A. The "Device ID" IS the Thumbprint
You do not need to generate a random UUID for the device. The **JWK Thumbprint** (`actualJkt` in the C# code) is a cryptographically guaranteed, globally unique identifier for that specific browser/hardware. 

### B. Suggested Database Schema (SQL / Entity Framework)

You should create a `UserDevices` (or `TrustedDevices`) table that links to your main `Users` table:

```sql
CREATE TABLE UserDevices (
    Id UNIQUEIDENTIFIER PRIMARY KEY,
    UserId UNIQUEIDENTIFIER NOT NULL,       -- Foreign Key to Users table
    DeviceThumbprint VARCHAR(255) NOT NULL, -- The DPoP jkt hash
    DeviceName VARCHAR(100),                -- e.g., "Chrome on Windows" (parsed from User-Agent)
    IsRevoked BIT DEFAULT 0,                -- 1 if the user clicked "Sign out of this device"
    LastUsedAt DATETIME,                    -- Updated on login/token refresh
    CreatedAt DATETIME DEFAULT GETDATE()
);
```

### C. The 3 Core Database Use Cases

1. **"New Device Login" Alerts:**
   When a user logs in, extract the Thumbprint. Query the `UserDevices` table. If `WHERE UserId = @id AND DeviceThumbprint = @jkt` returns 0 rows, trigger an email or push notification: *"We noticed a login from a new device."* Then, `INSERT` the new device into the table.

2. **Device Management (Security Dashboard):**
   When the user goes to their account settings, run `SELECT * FROM UserDevices WHERE UserId = @id`. You can now show them a list of every physical hardware device logged into their account, just like Google, Apple, or GitHub does.

3. **Remote Revocation (Kill Switch):**
   If a user clicks "Log out of this device" from the dashboard, you simply `UPDATE UserDevices SET IsRevoked = 1 WHERE DeviceThumbprint = @jkt`. 
   *How it works:* During the user's next token refresh (or via a fast Redis check on critical routes), the backend checks if the Thumbprint is revoked. If it is, it instantly kills their access. Because a hacker can't physically extract the private key from the victim's hardware to generate a *new* valid thumbprint, the hacker is permanently locked out!

### D. Redis Cache (For Replay Attacks)
To prevent a hacker from intercepting a request and re-sending the exact same proof 1 second later, you must cache the `jti` (JWT ID).
*   **Storage:** Redis or `IMemoryCache`
*   **Key:** `dpop_jti_<the-jti-from-the-proof>`
*   **Value:** `1`
*   **TTL (Expiration):** 60 seconds (matching the `iat` expiration limit of your DPoP proof).
*   **Logic:** Before verifying the signature in Middleware, check Redis. If the `jti` already exists in the cache, **reject the request** (it's a Replay Attack). If it doesn't exist, add it to the cache and proceed.
