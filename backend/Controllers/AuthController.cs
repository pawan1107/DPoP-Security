using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace Backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _config;

    public AuthController(IConfiguration config)
    {
        _config = config;
    }

    [HttpPost("login")]
    public IActionResult Login()
    {
        // 1. Get DPoP header
        if (!Request.Headers.TryGetValue("DPoP", out var dpopHeader))
        {
            return BadRequest("Missing DPoP header during login.");
        }

        var dpopProof = dpopHeader.ToString();
        var jwtHandler = new JwtSecurityTokenHandler();

        if (!jwtHandler.CanReadToken(dpopProof))
        {
            return BadRequest("Invalid DPoP JWT format.");
        }

        var token = jwtHandler.ReadJwtToken(dpopProof);
        
        // Extract the JWK from the JWT header
        if (!token.Header.TryGetValue("jwk", out var jwkObj))
        {
            return BadRequest("Missing jwk in DPoP header.");
        }

        // Convert the generic object to JsonElement, then back to a dictionary for Microsoft.IdentityModel.Tokens.JsonWebKey
        var jwkJsonStr = JsonSerializer.Serialize(jwkObj);
        var jsonWebKey = new JsonWebKey(jwkJsonStr);

        // Compute the thumbprint according to RFC 7638
        var jkt = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());

        // Create Access Token
        string issuer = _config["Jwt:Issuer"] ?? "https://localhost:5001";
        string audience = _config["Jwt:Audience"] ?? "https://localhost:5001";
        string keyStr = _config["Jwt:Key"] ?? "supersecret_secretkey_must_be_long_12345!";

        var securityKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(keyStr));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        // Standard claims
        var claims = new System.Collections.Generic.Dictionary<string, object>();
        // Add the confirmation claim containing the thumbprint
        claims.Add("cnf", new Dictionary<string, string> { { "jkt", jkt } });

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = credentials,
            Claims = claims
        };

        var finalToken = jwtHandler.CreateToken(descriptor);
        var tokenString = jwtHandler.WriteToken(finalToken);

        return Ok(new { access_token = tokenString, token_type = "DPoP", expires_in = 3600 });
    }
}
