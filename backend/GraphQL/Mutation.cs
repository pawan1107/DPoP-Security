using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using HotChocolate;

namespace Backend.GraphQL;

public class LoginPayload
{
    public string? AccessToken { get; set; }
    public string? TokenType { get; set; }
    public int ExpiresIn { get; set; }
    public string? Error { get; set; }
}

public class Mutation
{
    public LoginPayload Login(
        [Service] IHttpContextAccessor httpContextAccessor,
        [Service] IConfiguration config)
    {
        var context = httpContextAccessor.HttpContext;
        if (context == null)
        {
            return new LoginPayload { Error = "No HTTP context available." };
        }

        if (!context.Request.Headers.TryGetValue("DPoP", out var dpopHeader))
        {
            return new LoginPayload { Error = "Missing DPoP header during login." };
        }

        var dpopProof = dpopHeader.ToString();
        var jwtHandler = new JwtSecurityTokenHandler();

        if (!jwtHandler.CanReadToken(dpopProof))
        {
            return new LoginPayload { Error = "Invalid DPoP JWT format." };
        }

        var token = jwtHandler.ReadJwtToken(dpopProof);

        if (!token.Header.TryGetValue("jwk", out var jwkObj))
        {
            return new LoginPayload { Error = "Missing jwk in DPoP header." };
        }

        var jwkJsonStr = JsonSerializer.Serialize(jwkObj);
        var jsonWebKey = new JsonWebKey(jwkJsonStr);

        var jkt = Base64UrlEncoder.Encode(jsonWebKey.ComputeJwkThumbprint());

        string issuer = config["Jwt:Issuer"] ?? "https://localhost:5001";
        string audience = config["Jwt:Audience"] ?? "https://localhost:5001";
        string keyStr = config["Jwt:Key"] ?? "supersecret_secretkey_must_be_long_12345!";

        var securityKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(keyStr));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new Dictionary<string, object>
        {
            { "cnf", new Dictionary<string, string> { { "jkt", jkt } } }
        };

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

        return new LoginPayload
        {
            AccessToken = tokenString,
            TokenType = "DPoP",
            ExpiresIn = 3600
        };
    }
}
