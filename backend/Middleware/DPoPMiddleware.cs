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
                
                if (!token.Header.TryGetValue("jwk", out var jwkObj))
                {
                    dpopError = "Missing jwk in DPoP header.";
                }
                else
                {
                    var jwkJsonStr = JsonSerializer.Serialize(jwkObj);
                    var jsonWebKey = new JsonWebKey(jwkJsonStr);
                    string actualJkt = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());

                    // Expose the public key thumbprint to downstream controllers 
                    // This acts as a cryptographically verifiable "Device ID"
                    context.Items["DPoP_Thumbprint"] = actualJkt;

                    try 
                    {
                        // Verify the signature of the DPoP Proof using the embedded public key
                         var validationParameters = new TokenValidationParameters
                        {
                            ValidateIssuer = false,
                            ValidateAudience = false,
                            ValidateLifetime = false,
                            IssuerSigningKey = jsonWebKey
                        };
                        jwtHandler.ValidateToken(dpopProof, validationParameters, out var validatedToken);

                        // Validate htm and htu
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
                            // If it's a DPoP authenticated request, we must also validate the cnf claim
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
                                    dpopError = "DPoP proof thumbprint mismatch. Expected " + expectedJkt + " but proof was signed by " + actualJkt;
                                }
                                else if (string.IsNullOrEmpty(dpopError))
                                {
                                    dpopValid = true;
                                }
                            }
                        }
                        else
                        {
                            // It's an unauthenticated request with a cryptographically valid DPoP proof
                            dpopValid = true;
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

        // We DO NOT return 401 Unauthorized here anymore.
        // We simply flag the connection so downstream controllers/middleware can decide what to do.
        context.Items["DPoP_Valid"] = dpopValid;
        context.Items["DPoP_Error"] = dpopError;

        await _next(context);
    }
}

public static class DPoPMiddlewareExtensions
{
    public static IApplicationBuilder UseDPoPValidation(this IApplicationBuilder builder)
    {
        return builder.UseMiddleware<DPoPMiddleware>();
    }
}
