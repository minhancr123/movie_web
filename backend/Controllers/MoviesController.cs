using backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MoviesController : ControllerBase
    {
        private readonly MovieService _movieService;

        public MoviesController(MovieService movieService)
        {
            _movieService = movieService;
        }

        [HttpGet("latest")]
        public async Task<IActionResult> GetLatest([FromQuery] int page = 1)
        {
            var data = await _movieService.GetLatestMovies(page);
            return Content(data, "application/json");
        }

        [HttpGet("details/{slug}")]
        public async Task<IActionResult> GetDetails(string slug)
        {
            var data = await _movieService.GetMovieDetail(slug);
            if (data == null) return NotFound(new { message = "Không tìm thấy phim" });
            return Content(data, "application/json");
        }
        
        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string keyword, [FromQuery] int limit = 10)
        {
             var data = await _movieService.SearchMovies(keyword, limit);
             return Content(data, "application/json");
        }

        [HttpGet("category/{categoryName}")]
        public async Task<IActionResult> GetByCategory(string categoryName, [FromQuery] int page = 1)
        {
             // Mapping visual names to API slugs if needed, but usually frontend sends correct slug
             // e.g. phim-le, phim-bo, tv-shows, hoat-hinh
             var data = await _movieService.GetMoviesByCategory(categoryName, page);
             return Content(data, "application/json");
        }

        [HttpGet("genre/{genreName}")]
        public async Task<IActionResult> GetByGenre(string genreName, [FromQuery] int page = 1)
        {
            var data = await _movieService.GetMoviesByGenre(genreName, page);
            return Content(data, "application/json");
        }

        [HttpGet("country/{countryName}")]
        public async Task<IActionResult> GetByCountry(string countryName, [FromQuery] int page = 1)
        {
            var data = await _movieService.GetMoviesByCountry(countryName, page);
            return Content(data, "application/json");
        }

        [HttpDelete("cache")]
        public async Task<IActionResult> ClearCache([FromQuery] string? key, [FromQuery] string? secret)
        {
             // Simple protection
             if (secret != "admin123") // Change this in production
             {
                 return Unauthorized(new { message = "Invalid Secret Key" });
             }

             await _movieService.ClearCacheAsync(key);
             return Ok(new { message = string.IsNullOrEmpty(key) ? "All Cache Cleared (Redis)" : $"Cache Key '{key}' Cleared" });
        }

        [HttpPost("views/{slug}")]
        public async Task<IActionResult> IncreaseView(string slug)
        {
            var views = await _movieService.IncrementViewCount(slug);
            return Ok(new { views });
        }

        [HttpGet("views/{slug}")]
        public async Task<IActionResult> GetViewCount(string slug)
        {
            var views = await _movieService.GetViewCount(slug);
            return Ok(new { views }); 
        }

        [HttpPost("admin/rate-limit")]
        public async Task<IActionResult> SetRateLimit([FromQuery] int limit, [FromQuery] string secret)
        {
             if (secret != "admin123") return Unauthorized();
             await _movieService.SetSystemRateLimit(limit);
             return Ok(new { message = $"Rate limit set to {limit} req/min" });
        }

        [HttpGet("admin/rate-limit")]
        public async Task<IActionResult> GetRateLimit([FromQuery] string secret)
        {
             if (secret != "admin123") return Unauthorized();
             var limit = await _movieService.GetSystemRateLimit();
             return Ok(new { limit });
        }

        [HttpGet("admin/stats")]
        public async Task<IActionResult> GetSystemStats([FromQuery] string secret)
        {
             if (secret != "admin123") return Unauthorized();
             
             var totalViews = await _movieService.GetTotalViews();
             var totalRequests = await _movieService.GetRequestCount();
             var activeUsers = await _movieService.GetActiveUsersEstimate();
             var requestRate = activeUsers * 4; // Estimate
             
             return Ok(new 
             {
                 activeUsers,
                 requestRate,
                 totalViews,
                 totalRequests,
                 serverTime = DateTime.UtcNow
             });
        }
    }
}
