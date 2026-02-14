using backend.Services;
using Microsoft.AspNetCore.ResponseCompression;
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

// Health check endpoint for Docker
app.MapGet("/health", () => Results.Ok(new { status = "healthy", timestamp = DateTime.UtcNow }));

app.Run();
