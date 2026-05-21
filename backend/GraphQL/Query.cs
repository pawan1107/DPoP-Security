using HotChocolate.Authorization;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Backend.GraphQL;

public class WeatherForecast
{
    public DateOnly Date { get; set; }
    public int TemperatureC { get; set; }
    public string? Summary { get; set; }
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}

public class WeatherResponse
{
    public IEnumerable<WeatherForecast> Data { get; set; } = new List<WeatherForecast>();
    public string Device_ID { get; set; } = "No DPoP Key";
    public bool DPoP_Valid { get; set; } = false;
    public string? DPoP_Error { get; set; }
}

public class StringDataResponse
{
    public string Data { get; set; } = "";
    public string Device_ID { get; set; } = "No DPoP Key";
    public bool DPoP_Valid { get; set; } = false;
    public string? DPoP_Error { get; set; }
}

public class Query
{
    private static readonly string[] Summaries = new[]
    {
        "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
    };

    [Authorize]
    public WeatherResponse GetWeatherForecast([Service] IHttpContextAccessor httpContextAccessor)
    {
        var context = httpContextAccessor.HttpContext;
        var forecast = Enumerable.Range(1, 5).Select(index =>
            new WeatherForecast
            {
                Date = DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
                TemperatureC = Random.Shared.Next(-20, 55),
                Summary = Summaries[Random.Shared.Next(Summaries.Length)]
            })
            .ToList();

        return new WeatherResponse
        {
            Data = forecast,
            Device_ID = context?.Items["DPoP_Thumbprint"]?.ToString() ?? "No DPoP Key",
            DPoP_Valid = context?.Items["DPoP_Valid"] as bool? ?? false,
            DPoP_Error = context?.Items["DPoP_Error"]?.ToString()
        };
    }

    public WeatherResponse GetPublicWeather([Service] IHttpContextAccessor httpContextAccessor)
    {
        var context = httpContextAccessor.HttpContext;
        var forecast = Enumerable.Range(1, 5).Select(index =>
            new WeatherForecast
            {
                Date = DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
                TemperatureC = Random.Shared.Next(-20, 55),
                Summary = Summaries[Random.Shared.Next(Summaries.Length)]
            })
            .ToList();

        return new WeatherResponse
        {
            Data = forecast,
            Device_ID = context?.Items["DPoP_Thumbprint"]?.ToString() ?? "No DPoP Key",
            DPoP_Valid = context?.Items["DPoP_Valid"] as bool? ?? false,
            DPoP_Error = context?.Items["DPoP_Error"]?.ToString()
        };
    }

    public StringDataResponse GetApiWeather([Service] IHttpContextAccessor httpContextAccessor)
    {
        var context = httpContextAccessor.HttpContext;
        var conditions = new[] { "Sunny", "Cloudy", "Rainy", "Snowy", "Windy" };
        return new StringDataResponse
        {
            Data = conditions[Random.Shared.Next(conditions.Length)],
            Device_ID = context?.Items["DPoP_Thumbprint"]?.ToString() ?? "No DPoP Key",
            DPoP_Valid = context?.Items["DPoP_Valid"] as bool? ?? false,
            DPoP_Error = context?.Items["DPoP_Error"]?.ToString()
        };
    }

    public StringDataResponse GetApiTemperature([Service] IHttpContextAccessor httpContextAccessor)
    {
        var context = httpContextAccessor.HttpContext;
        return new StringDataResponse
        {
            Data = $"{Random.Shared.Next(-10, 40)}°C",
            Device_ID = context?.Items["DPoP_Thumbprint"]?.ToString() ?? "No DPoP Key",
            DPoP_Valid = context?.Items["DPoP_Valid"] as bool? ?? false,
            DPoP_Error = context?.Items["DPoP_Error"]?.ToString()
        };
    }

    public StringDataResponse GetApiSeason([Service] IHttpContextAccessor httpContextAccessor)
    {
        var context = httpContextAccessor.HttpContext;
        var seasons = new[] { "Spring", "Summer", "Autumn", "Winter" };
        return new StringDataResponse
        {
            Data = seasons[Random.Shared.Next(seasons.Length)],
            Device_ID = context?.Items["DPoP_Thumbprint"]?.ToString() ?? "No DPoP Key",
            DPoP_Valid = context?.Items["DPoP_Valid"] as bool? ?? false,
            DPoP_Error = context?.Items["DPoP_Error"]?.ToString()
        };
    }
}
