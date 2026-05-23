using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

const int TOTAL_REQUESTS = 1000;

Console.WriteLine($"\n🔐 .NET ECDSA P-256 DPoP Signature Verification Benchmark");
Console.WriteLine($"   Simulating {TOTAL_REQUESTS} concurrent DPoP verifications...\n");

// Step 1: Generate 1000 unique ECDSA key pairs (simulating 1000 different devices)
Console.WriteLine($"⏳ Generating {TOTAL_REQUESTS} unique device key pairs...");
var sw = Stopwatch.StartNew();
var keys = new ECDsa[TOTAL_REQUESTS];
for (int i = 0; i < TOTAL_REQUESTS; i++)
{
    keys[i] = ECDsa.Create(ECCurve.NamedCurves.nistP256);
}
sw.Stop();
Console.WriteLine($"✅ Key generation: {sw.ElapsedMilliseconds}ms total ({(double)sw.ElapsedMilliseconds / TOTAL_REQUESTS:F3}ms per key)\n");

// Step 2: Create 1000 signed DPoP JWTs (simulating clients sending proofs)
Console.WriteLine($"⏳ Signing {TOTAL_REQUESTS} DPoP JWT proofs...");
var proofs = new string[TOTAL_REQUESTS];
var jwtHandler = new JwtSecurityTokenHandler();
sw.Restart();
for (int i = 0; i < TOTAL_REQUESTS; i++)
{
    var ecdsaKey = new ECDsaSecurityKey(keys[i]);
    var signingCreds = new SigningCredentials(ecdsaKey, SecurityAlgorithms.EcdsaSha256);

    // Export public key as JWK (this is what the client embeds in the header)
    var jwk = JsonWebKeyConverter.ConvertFromECDsaSecurityKey(ecdsaKey);
    var publicJwk = new Dictionary<string, string>
    {
        { "kty", jwk.Kty }, { "crv", jwk.Crv }, { "x", jwk.X }, { "y", jwk.Y }
    };

    var header = new JwtHeader(signingCreds);
    header["typ"] = "dpop+jwt";
    header["jwk"] = publicJwk;

    var payload = new JwtPayload
    {
        { "jti", Guid.NewGuid().ToString() },
        { "htm", "POST" },
        { "htu", "http://localhost:5083/graphql" },
        { "iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds() }
    };

    var token = new JwtSecurityToken(header, payload);
    proofs[i] = jwtHandler.WriteToken(token);
}
sw.Stop();
Console.WriteLine($"✅ Signing: {sw.ElapsedMilliseconds}ms total ({(double)sw.ElapsedMilliseconds / TOTAL_REQUESTS:F3}ms per sign)\n");

// Step 3: Verify all 1000 signatures (THIS IS EXACTLY what your DPoP middleware does)
Console.WriteLine($"⏳ Verifying {TOTAL_REQUESTS} DPoP signatures (simulating middleware under load)...");
int validCount = 0;
sw.Restart();

for (int i = 0; i < TOTAL_REQUESTS; i++)
{
    // --- THIS IS THE EXACT MIDDLEWARE LOGIC ---
    var dpopToken = jwtHandler.ReadJwtToken(proofs[i]);

    // Extract JWK from header
    dpopToken.Header.TryGetValue("jwk", out var jwkObj);
    var jwkJsonStr = JsonSerializer.Serialize(jwkObj);
    var jsonWebKey = new JsonWebKey(jwkJsonStr);

    // Calculate thumbprint (Device ID)
    string thumbprint = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());

    // Cryptographically verify the signature
    var validationParameters = new TokenValidationParameters
    {
        ValidateIssuer = false,
        ValidateAudience = false,
        ValidateLifetime = false,
        IssuerSigningKey = jsonWebKey
    };
    jwtHandler.ValidateToken(proofs[i], validationParameters, out var validatedToken);
    validCount++;
}

sw.Stop();

Console.WriteLine($"\n{"=".PadRight(55, '=')}");
Console.WriteLine($"  RESULTS: {TOTAL_REQUESTS} DPoP Verifications (.NET Runtime)");
Console.WriteLine($"{"=".PadRight(55, '=')}");
Console.WriteLine($"  All Signatures Valid: {(validCount == TOTAL_REQUESTS ? "✅ YES" : "❌ NO")} ({validCount}/{TOTAL_REQUESTS})");
Console.WriteLine($"  Total Wall Time:      {sw.ElapsedMilliseconds}ms");
Console.WriteLine($"  Per Request:          {(double)sw.ElapsedMilliseconds / TOTAL_REQUESTS:F3}ms");
Console.WriteLine($"  Throughput:           ~{(int)(TOTAL_REQUESTS / sw.Elapsed.TotalSeconds)} verifications/sec");
Console.WriteLine($"{"=".PadRight(55, '=')}");
Console.WriteLine();

// Cleanup
foreach (var key in keys) key.Dispose();
