# MovieWeb - Push All Services as Single Multi-Service Image
# Usage: .\push-all-services.ps1

param(
    [string]$DockerUsername = "minhancr123",
    [string]$ImageName = "movie-web",
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

Write-Host "🐳 Building and Pushing MovieWeb Multi-Service Image" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
if (-not (docker info 2>$null)) {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Check if logged in to Docker Hub
Write-Host "Checking Docker Hub authentication..." -ForegroundColor Yellow
$dockerInfo = docker info 2>&1 | Select-String "Username"
if ($dockerInfo) {
    Write-Host "✅ Docker Hub authentication successful" -ForegroundColor Green
} else {
    Write-Host "⚠️  Please login to Docker Hub" -ForegroundColor Yellow
    docker login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker Hub login failed." -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# Full image names
$IMAGE_NODE = "${DockerUsername}/${ImageName}:node-${Version}"
$IMAGE_CSHARP = "${DockerUsername}/${ImageName}:csharp-${Version}"
$IMAGE_NODE_LATEST = "${DockerUsername}/${ImageName}:node-latest"
$IMAGE_CSHARP_LATEST = "${DockerUsername}/${ImageName}:csharp-latest"
$IMAGE_LATEST = "${DockerUsername}/${ImageName}:latest"

Write-Host "📦 Images to be created:" -ForegroundColor Cyan
Write-Host "  - ${IMAGE_NODE}" -ForegroundColor White
Write-Host "  - ${IMAGE_CSHARP}" -ForegroundColor White
Write-Host "  - ${IMAGE_NODE_LATEST}" -ForegroundColor White
Write-Host "  - ${IMAGE_CSHARP_LATEST}" -ForegroundColor White
Write-Host "  - ${IMAGE_LATEST}" -ForegroundColor White
Write-Host ""
Write-Host "Note: Redis uses official image" -ForegroundColor Gray
Write-Host ""

$confirmation = Read-Host "Continue y or n"
if ($confirmation -ne 'y') {
    Write-Host "❌ Cancelled by user" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan

# ============================================
# Build and Push Node.js Backend
# ============================================
Write-Host ""
Write-Host "🔨 [1/2] Building Node.js Backend..." -ForegroundColor Yellow
docker build -t "${IMAGE_NODE}" -f backend-node/Dockerfile ./backend-node
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js Backend build successful" -ForegroundColor Green

# Tag as node-latest
docker tag "${IMAGE_NODE}" "${IMAGE_NODE_LATEST}"

# Tag as latest (Node.js is the main backend)
docker tag "${IMAGE_NODE}" "${IMAGE_LATEST}"

Write-Host ""
Write-Host "⬆️  Pushing Node.js Backend..." -ForegroundColor Yellow
docker push "${IMAGE_NODE}"
docker push "${IMAGE_NODE_LATEST}"
docker push "${IMAGE_LATEST}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js Backend push failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js Backend pushed successfully" -ForegroundColor Green

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan

# ============================================
# Build and Push C# Backend
# ============================================
Write-Host ""
Write-Host "🔨 [2/2] Building C# Backend..." -ForegroundColor Yellow
docker build -t "${IMAGE_CSHARP}" -f backend/Dockerfile ./backend
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ C# Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ C# Backend build successful" -ForegroundColor Green

# Tag as csharp-latest
docker tag "${IMAGE_CSHARP}" "${IMAGE_CSHARP_LATEST}"

Write-Host ""
Write-Host "⬆️  Pushing C# Backend..." -ForegroundColor Yellow
docker push "${IMAGE_CSHARP}"
docker push "${IMAGE_CSHARP_LATEST}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ C# Backend push failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ C# Backend pushed successfully" -ForegroundColor Green

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🎉 All images pushed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Pushed Images:" -ForegroundColor Cyan
Write-Host "  Node.js Backend:" -ForegroundColor Yellow
Write-Host "    - ${IMAGE_NODE}" -ForegroundColor White
Write-Host "    - ${IMAGE_NODE_LATEST}" -ForegroundColor White
Write-Host ""
Write-Host "  C# Backend:" -ForegroundColor Yellow
Write-Host "    - ${IMAGE_CSHARP}" -ForegroundColor White
Write-Host "    - ${IMAGE_CSHARP_LATEST}" -ForegroundColor White
Write-Host ""
Write-Host "  Latest (Default):" -ForegroundColor Yellow
Write-Host "    - ${IMAGE_LATEST} -> Node.js Backend" -ForegroundColor White
Write-Host ""
Write-Host "  Redis:" -ForegroundColor Yellow
Write-Host "    - Official Redis Alpine image" -ForegroundColor White
Write-Host ""
Write-Host "🔗 View on Docker Hub:" -ForegroundColor Cyan
Write-Host "  https://hub.docker.com/r/${DockerUsername}/${ImageName}" -ForegroundColor Blue
Write-Host ""
Write-Host "📝 Usage on VPS:" -ForegroundColor Cyan
Write-Host "  # Node.js Backend" -ForegroundColor Gray
Write-Host "  docker pull ${IMAGE_NODE_LATEST}" -ForegroundColor White
Write-Host ""
Write-Host "  # C# Backend" -ForegroundColor Gray
Write-Host "  docker pull ${IMAGE_CSHARP_LATEST}" -ForegroundColor White
Write-Host ""
Write-Host "  # Or use docker-compose" -ForegroundColor Gray
Write-Host "  docker-compose -f docker-compose.prod.yml pull" -ForegroundColor White
Write-Host "  docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor White
Write-Host ""
