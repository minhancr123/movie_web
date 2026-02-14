using backend.Services;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Caching.Distributed;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// 1. Enable Response Compression (Gzip/Brotli) to reduce API payload size
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});

builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.SmallestSize;
});

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

// --- CACHE CONFIGURATION ---
var redisConnectionString = builder.Configuration.GetConnectionString("Redis");

if (!string.IsNullOrEmpty(redisConnectionString))
{
    // Use Redis if connection string is present
    builder.Services.AddStackExchangeRedisCache(options =>
    {
        options.Configuration = redisConnectionString;
        options.InstanceName = "MovieWeb_";
    });
    Console.WriteLine("--> Using Redis Distributed Cache");
}
else
{
    // Fallback to Memory Cache
    builder.Services.AddDistributedMemoryCache();
    Console.WriteLine("--> Using In-Memory Distributed Cache");
}

builder.Services.AddHttpClient<MovieService>(); // Register HTTP Client for MovieService

// Enable CORS from appsettings
var frontendUrl = builder.Configuration["MovieSettings:FrontendUrl"] ?? "http://localhost:3000";
// Support multiple origins separated by comma
var allowedOrigins = frontendUrl.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(o => o.Trim()).ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowNextApp",
        builder => builder
        .WithOrigins(allowedOrigins)
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials());
});

var app = builder.Build();

// --- RATE LIMIT MIDDLEWARE ---
app.Use(async (context, next) => {
    // Apply only to API endpoints
    if (context.Request.Path.StartsWithSegments("/api")) {
         var cache = context.RequestServices.GetRequiredService<IDistributedCache>();
         // Use X-Forwarded-For if behind proxy, else RemoteIpAddress
         var ip = context.Request.Headers["X-Forwarded-For"].FirstOrDefault() ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
         
         // 1. Get Global Limit Config (Default 60 req/min/IP)
         var limitStr = await cache.GetStringAsync("sys:rate_limit");
         int limit = 200; // Default safe limit
         if (!string.IsNullOrEmpty(limitStr) && int.TryParse(limitStr, out var l)) limit = l;
         
         // 2. Count requests per minute for this IP
         var key = $"rate:{ip}:{DateTime.UtcNow:yyyyMMddHHmm}";
         var countStr = await cache.GetStringAsync(key);
         int count = 0;
         if (!string.IsNullOrEmpty(countStr) && int.TryParse(countStr, out var c)) count = c;
         
         if (count >= limit) {
             context.Response.StatusCode = 429;
             context.Response.ContentType = "application/json";
             await context.Response.WriteAsync("{\"message\": \"Too Many Requests. Please try again later.\"}");
             return;
         }
         
         // Increment Per-IP Rate Limit
         await cache.SetStringAsync(key, (count + 1).ToString(), new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1) });
    
         // --- GLOBAL STATS TRACKING ---
         // 1. Total Requests (Persistent-ish)
         // Note: Not atomic
         var totalKey = "stats:req_total";
         var totalVal = await cache.GetStringAsync(totalKey);
         long total = 0;
         if (long.TryParse(totalVal, out var t)) total = t;
         // Save, expire in 30 days
         await cache.SetStringAsync(totalKey, (total + 1).ToString(), new DistributedCacheEntryOptions { SlidingExpiration = TimeSpan.FromDays(30) });

         // 2. Current Minute Requests (For Rate/Active User calc)
         var minKey = "stats:req_current_min"; // Just overwrite/increment. Wait, this never resets if I just inc.
         // Actually, let's use a time-bucket key
         var timeBucket = DateTime.UtcNow.ToString("yyyyMMddHHmm");
         var bucketKey = $"stats:req_bucket:{timeBucket}";
         var bucketVal = await cache.GetStringAsync(bucketKey);
         int bucketCount = 0;
         if (int.TryParse(bucketVal, out var b)) bucketCount = b;
         await cache.SetStringAsync(bucketKey, (bucketCount + 1).ToString(), new DistributedCacheEntryOptions { AbsoluteExpiration = DateTimeOffset.UtcNow.AddMinutes(2) });
         
         // Also update the "current_min" pointer for easier service access? 
         // Service can just generate same key.
         // Let's update Service to use the bucket key logic.
    }
    await next();
});

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// 2. Use Response Compression Middleware (Must be before MapControllers)
app.UseResponseCompression();

app.UseHttpsRedirection();

// Explicitly define CORS policy
app.UseCors("AllowNextApp");

        
app.UseAuthorization();
app.MapControllers();

// Health check endpoint for Docker with Redis check
app.MapGet("/health", async (IDistributedCache cache) =>
{
    try
    {
        // Test Redis connection by setting and getting a test value
        var testKey = "health-check-test";
        await cache.SetStringAsync(testKey, "ok", new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(5)
        });
        
        var testValue = await cache.GetStringAsync(testKey);
        
        if (testValue == "ok")
        {
            return Results.Ok(new
            {
                status = "healthy",
                redis = "connected",
                timestamp = DateTime.UtcNow
            });
        }
        else
        {
            return Results.Json(new
            {
                status = "degraded",
                redis = "disconnected",
                timestamp = DateTime.UtcNow
            }, statusCode: 503);
        }
    }
    catch (Exception ex)
    {
        return Results.Json(new
        {
            status = "unhealthy",
            redis = "error",
            error = ex.Message,
            timestamp = DateTime.UtcNow
        }, statusCode: 503);
    }
});

app.Run();
