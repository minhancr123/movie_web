# MovieWeb - Push Docker Images to Docker Hub
# Usage: .\push-to-dockerhub.ps1

param(
    [string]$DockerUsername = "minhancr123",
    [string]$Version = "latest"
)

Write-Host "🐳 Building and Pushing MovieWeb Docker Images" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
if (-not (docker info 2>$null)) {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Check if logged in to Docker Hub
Write-Host "Checking Docker Hub authentication..." -ForegroundColor Yellow
docker info | Select-String "Username" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Not logged in to Docker Hub. Logging in..." -ForegroundColor Yellow
    docker login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker Hub login failed." -ForegroundColor Red
        exit 1
    }
}
Write-Host "✅ Docker Hub authentication successful" -ForegroundColor Green
Write-Host ""

# Image names
$IMAGE_NODE = "${DockerUsername}/movieweb-backend-node"
$IMAGE_CSHARP = "${DockerUsername}/movieweb-backend-csharp"
$IMAGE_REDIS = "redis:7-alpine"  # Using official Redis image

Write-Host "📦 Images to be built and pushed:" -ForegroundColor Cyan
Write-Host "  - ${IMAGE_NODE}:${Version}" -ForegroundColor White
Write-Host "  - ${IMAGE_CSHARP}:${Version}" -ForegroundColor White
Write-Host "  Note: Using official Redis image (${IMAGE_REDIS})" -ForegroundColor Gray
Write-Host ""

# Ask for confirmation
$confirmation = Read-Host "Continue? (y/n)"
if ($confirmation -ne 'y') {
    Write-Host "❌ Cancelled by user" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan

# Build and Push Node.js Backend
Write-Host ""
Write-Host "🔨 Building Node.js Backend..." -ForegroundColor Yellow
docker build -t "${IMAGE_NODE}:${Version}" -f backend-node/Dockerfile ./backend-node
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js Backend build successful" -ForegroundColor Green

Write-Host ""
Write-Host "⬆️  Pushing Node.js Backend to Docker Hub..." -ForegroundColor Yellow
docker push "${IMAGE_NODE}:${Version}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js Backend push failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node.js Backend pushed successfully" -ForegroundColor Green

# Tag as latest if version is not latest
if ($Version -ne "latest") {
    docker tag "${IMAGE_NODE}:${Version}" "${IMAGE_NODE}:latest"
    docker push "${IMAGE_NODE}:latest"
    Write-Host "✅ Also tagged and pushed as 'latest'" -ForegroundColor Green
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan

# Build and Push C# Backend
Write-Host ""
Write-Host "🔨 Building C# Backend..." -ForegroundColor Yellow
docker build -t "${IMAGE_CSHARP}:${Version}" -f backend/Dockerfile ./backend
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ C# Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ C# Backend build successful" -ForegroundColor Green

Write-Host ""
Write-Host "⬆️  Pushing C# Backend to Docker Hub..." -ForegroundColor Yellow
docker push "${IMAGE_CSHARP}:${Version}"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ C# Backend push failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ C# Backend pushed successfully" -ForegroundColor Green

# Tag as latest if version is not latest
if ($Version -ne "latest") {
    docker tag "${IMAGE_CSHARP}:${Version}" "${IMAGE_CSHARP}:latest"
    docker push "${IMAGE_CSHARP}:latest"
    Write-Host "✅ Also tagged and pushed as 'latest'" -ForegroundColor Green
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🎉 All images pushed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Pushed Images:" -ForegroundColor Cyan
Write-Host "  - ${IMAGE_NODE}:${Version}" -ForegroundColor White
Write-Host "  - ${IMAGE_CSHARP}:${Version}" -ForegroundColor White
if ($Version -ne "latest") {
    Write-Host "  - ${IMAGE_NODE}:latest" -ForegroundColor White
    Write-Host "  - ${IMAGE_CSHARP}:latest" -ForegroundColor White
}
Write-Host ""
Write-Host "🔗 View on Docker Hub:" -ForegroundColor Cyan
Write-Host "  - https://hub.docker.com/r/${DockerUsername}/movieweb-backend-node" -ForegroundColor Blue
Write-Host "  - https://hub.docker.com/r/${DockerUsername}/movieweb-backend-csharp" -ForegroundColor Blue
Write-Host ""
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Update docker-compose.prod.yml to use your images" -ForegroundColor White
Write-Host "  2. On VPS: docker-compose pull" -ForegroundColor White
Write-Host "  3. On VPS: docker-compose up -d" -ForegroundColor White
Write-Host ""
