using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;

namespace backend.Services
{
    public class MovieService
    {
        private readonly HttpClient _httpClient;
        private readonly IDistributedCache _cache; // Changed from IMemoryCache
        private readonly string _api_url;
        private readonly IConfiguration _configuration;

        public MovieService(HttpClient httpClient, IConfiguration configuration, IDistributedCache cache)
        {
            _httpClient = httpClient;
            _cache = cache;
            _configuration = configuration;
            _api_url = configuration["MovieSettings:BaseApiUrl"] 
                       ?? throw new ArgumentNullException("MovieSettings:BaseApiUrl", "API URL not configured in appsettings or Environment Variables");
        }

        public async Task<string> GetLatestMovies(int page = 1)
        {
            string cacheKey = $"latest_movies_page_{page}";
            
            // Try get from Redis/DistCache
            var cachedData = await _cache.GetStringAsync(cacheKey);
            if (!string.IsNullOrEmpty(cachedData))
            {
                return cachedData;
            }

            var response = await _httpClient.GetAsync($"{_api_url}/danh-sach/phim-moi-cap-nhat?page={page}");
            response.EnsureSuccessStatusCode();
            var data = await response.Content.ReadAsStringAsync();

            // Save to Redis (10 mins)
            await _cache.SetStringAsync(cacheKey, data, new DistributedCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
            });
            
            return data;
        }

        public async Task<string> GetMovieDetail(string slug)
        {
            string cacheKey = $"movie_detail_{slug}";
            var cachedData = await _cache.GetStringAsync(cacheKey);
            if (!string.IsNullOrEmpty(cachedData))
            {
                return cachedData;
            }

            var response = await _httpClient.GetAsync($"{_api_url}/phim/{slug}");
            if (!response.IsSuccessStatusCode) return null;
            var data = await response.Content.ReadAsStringAsync();

            // Save to Redis (30 mins)
            await _cache.SetStringAsync(cacheKey, data, new DistributedCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30)
            });

            return data;
        }

        public async Task<string> SearchMovies(string keyword, int limit = 10)
        {
            string cacheKey = $"search_{keyword}_{limit}";
            var cachedData = await _cache.GetStringAsync(cacheKey);
            if (!string.IsNullOrEmpty(cachedData))
            {
                return cachedData;
            }

             var response = await _httpClient.GetAsync($"{_api_url}/v1/api/tim-kiem?keyword={keyword}&limit={limit}");
             if (!response.IsSuccessStatusCode) return "{}";
             var data = await response.Content.ReadAsStringAsync();

             // Save to Redis (5 mins)
             await _cache.SetStringAsync(cacheKey, data, new DistributedCacheEntryOptions
             {
                 AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5)
             });

             return data;
        }

        public async Task<string> GetMoviesByCategory(string category, int page = 1)
        {
             // API Documents: https://phimapi.com/v1/api/danh-sach/{category}
             // Valid categories: phim-le, phim-bo, hoat-hinh, tv-shows
             try 
             {
                 var response = await _httpClient.GetAsync($"{_api_url}/v1/api/danh-sach/{category}?page={page}&limit=24");
                 // response.EnsureSuccessStatusCode(); // This throws on 404
                 if (!response.IsSuccessStatusCode) 
                 {
                     // Return empty structure or try genre fallback if logic permits, but for now just safe return
                     return "{\"status\":false,\"msg\":\"Category not found or API error\",\"data\":{\"items\":[]}}";
                 }
                 return await response.Content.ReadAsStringAsync();
             }
             catch
             {
                 return "{\"status\":false,\"msg\":\"Internal Error\",\"data\":{\"items\":[]}}";
             }
        }

        public async Task<string> GetMoviesByGenre(string genre, int page = 1)
        {
             // API Documents: https://phimapi.com/v1/api/the-loai/{genre}
             try
             {
                 var response = await _httpClient.GetAsync($"{_api_url}/v1/api/the-loai/{genre}?page={page}&limit=24");
                 if (!response.IsSuccessStatusCode)
                 {
                      return "{\"status\":false,\"msg\":\"Genre not found or API error\",\"data\":{\"items\":[]}}";
                 }
                 return await response.Content.ReadAsStringAsync();
             }
             catch
             {
                 return "{\"status\":false,\"msg\":\"Internal Error\",\"data\":{\"items\":[]}}";
             }
        }

        public async Task<string> GetMoviesByCountry(string country, int page = 1)
        {
             // API Documents: https://phimapi.com/v1/api/quoc-gia/{country}
             try
             {
                 var response = await _httpClient.GetAsync($"{_api_url}/v1/api/quoc-gia/{country}?page={page}&limit=24");
                 // Validate if country endpoint exists/works
                 if (!response.IsSuccessStatusCode)
                 {
                      return "{\"status\":false,\"msg\":\"Country not found or API error\",\"data\":{\"items\":[]}}";
                 }
                 return await response.Content.ReadAsStringAsync();
             }
             catch
             {
                 return "{\"status\":false,\"msg\":\"Internal Error\",\"data\":{\"items\":[]}}";
             }
        }

        public async Task ClearCacheAsync(string? specificKey = null)
        {
            if (!string.IsNullOrEmpty(specificKey))
            {
                await _cache.RemoveAsync(specificKey);
                return;
            }

            // Flush All (Redis Only)
            var redisConnString = _configuration.GetConnectionString("Redis");
            if (!string.IsNullOrEmpty(redisConnString))
            {
                // This creates a dedicated connection just for flushing
                // In production, you might want to inject IConnectionMultiplexer
                try 
                {
                    using var redis = ConnectionMultiplexer.Connect(redisConnString);
                    var server = redis.GetServer(redis.GetEndPoints().First());
                    await server.FlushDatabaseAsync();
                }
                catch(Exception ex) 
                {
                    Console.WriteLine($"Error flushing Redis: {ex.Message}");
                    // Silently fail or fallback to manual key tracking if needed
                }
            }
        }
    }
}
