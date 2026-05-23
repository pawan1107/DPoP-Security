# DPoP API Integration & Implementation Contract (For Backend Engineering)

This document outlines the API contracts, middleware requirements, and database schema required to implement **Demonstrating Proof-of-Possession (DPoP)** for **Anonymous Device Tracking and Anti-Bot Security**. 

*(Note: This implementation is strictly for device fingerprinting and security, not for user username/password authentication).*

---

## 1. Required API Endpoints

### Endpoint 1: Device Initialization / Handshake
*   **Endpoint:** `POST /graphql` with Mutation `initDevice`
*   **Purpose:** Called by the frontend on page load to register their hardware device with the backend.
*   **Headers Required:**
    *   `DPoP: <jwt_proof_containing_public_key>`
*   **Request Body:** Empty (or basic client metadata if desired).
*   **Backend Steps:**
    1. Extract the `DPoP_Thumbprint` from the request context (already verified and injected by the middleware — no crypto code needed here).
    2. Check if this thumbprint already exists in the `KnownDevices` table.
    3. If it does not exist, insert a new record with the thumbprint and the current timestamp.
    4. If it already exists, update the `LastSeenAt` timestamp.
*   **Response:** 
    ```json
    { "success": true }
    ```

### Securing All Other API Routes
For all other standard API routes (e.g., fetching weather, submitting forms), you can enforce device verification:
1. Ensure the request has a valid `DPoP` header (verified by Middleware).
2. Ensure the `DPoP_Thumbprint` injected by the middleware has previously been registered in your `KnownDevices` database table.

---

## 2. Core Middleware Logic (Global Interceptor)

Every incoming request must pass through a DPoP Middleware.
*   **Input:** HTTP Request with `DPoP` header (containing the client's public key `jwk` and signed payload).
*   **Processing:**
    1. Validate DPoP signature using the embedded `jwk`.
    2. Validate Freshness: Extract the `iat` (Issued At) claim. If the proof is older than 60 seconds, reject the request — it is either a replay attack or a bot re-using old proofs.
    3. Validate Anti-Replay: Ensure the `jti` claim hasn't been used in the last 60s (via Redis or MemoryCache).
    4. Validate Binding: Extract `htm` (method) and `htu` (url) and ensure they match the current request.
    5. Compute `jkt` (JWK Thumbprint - Base64Url SHA-256 hash of the `jwk`).
*   **Output to Downstream:** Injects the computed `jkt` (Thumbprint) into the Request Context (e.g., `context.Items["DPoP_Thumbprint"]`). This acts as the globally unique **Device ID**.

### C# Implementation Snippets
Since you likely already have your own middleware/interceptor patterns, here are just the core C# snippets you need to handle the DPoP cryptography using `System.IdentityModel.Tokens.Jwt` and `Microsoft.IdentityModel.Tokens`:

**1. Extract the Public Key and Calculate Thumbprint (Device ID):**
```csharp
var token = jwtHandler.ReadJwtToken(dpopProof);
token.Header.TryGetValue("jwk", out var jwkObj);
var jsonWebKey = new JsonWebKey(JsonSerializer.Serialize(jwkObj));
string deviceThumbprint = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());
```

**2. Cryptographically Verify the DPoP Proof:**
```csharp
var validationParameters = new TokenValidationParameters {
    ValidateIssuer = false, ValidateAudience = false, ValidateLifetime = false,
    IssuerSigningKey = jsonWebKey 
};
jwtHandler.ValidateToken(dpopProof, validationParameters, out var validatedToken);
```

**3. Reject Stale Proofs (Timestamp Validation):**
```csharp
var iat = token.Claims.FirstOrDefault(c => c.Type == "iat")?.Value;
var issuedAt = DateTimeOffset.FromUnixTimeSeconds(long.Parse(iat));
if (DateTimeOffset.UtcNow - issuedAt > TimeSpan.FromSeconds(60))
{
    // Proof is too old — reject as replay/bot/spam
}
```

---

## 3. Database Schema: Known Devices

The DPoP Thumbprint (`jkt`) natively acts as a cryptographically secure, unforgeable **Device ID**. We simply need a table to track these devices.

```sql
CREATE TABLE KnownDevices (
    DeviceThumbprint VARCHAR(255) PRIMARY KEY, -- The DPoP jkt hash
    FirstSeenAt DATETIME DEFAULT GETDATE(),
    LastSeenAt DATETIME
);
```
