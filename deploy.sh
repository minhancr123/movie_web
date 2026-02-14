#!/bin/bash

# MovieWeb VPS Deployment Script
# Deploys: Redis, C# Backend, Node.js Backend
# Usage: ./deploy.sh

set -e

echo "🚀 Starting MovieWeb Full Backend Deployment..."

# Configuration
APP_DIR="/var/www/movieweb"
BACKUP_DIR="/var/backups/movieweb"
DATE=$(date +%Y%m%d_%H%M%S)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    log_error "Please run as root (use sudo)"
    exit 1
fi

cd $APP_DIR

# Backup current deployment
log_warning "Creating backup..."
mkdir -p $BACKUP_DIR
docker-compose logs backend-node > $BACKUP_DIR/logs_node_$DATE.log 2>&1 || true
docker-compose logs backend-csharp > $BACKUP_DIR/logs_csharp_$DATE.log 2>&1 || true
docker-compose logs redis > $BACKUP_DIR/logs_redis_$DATE.log 2>&1 || true
log_success "Backup created"

# Pull latest changes
log_warning "Pulling latest code..."
if [ -d ".git" ]; then
    git pull origin main || { log_error "Git pull failed"; exit 1; }
    log_success "Code updated"
else
    log_warning "Not a git repository, skipping pull"
fi

# Install dependencies (if package.json changed)
if [ -f "backend-node/package.json" ]; then
    log_warning "Checking for new dependencies..."
    cd backend-node
    npm install --production || { log_error "npm install failed"; exit 1; }
    cd ..
    log_success "Dependencies updated"
fi

# Stop current containers
log_warning "Stopping current containers..."
docker-compose down || true

# Build and start new containers
log_warning "Building and starting all services (Redis, C# Backend, Node.js Backend)..."
docker-compose -f docker-compose.prod.yml up -d --build || { log_error "Docker deployment failed"; exit 1; }

# Wait for services to be ready
log_warning "Waiting for services to be ready..."
sleep 15

# Health checks for all services
log_warning "Performing health checks..."

# Check Node.js Backend
NODE_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/health || echo "000")
if [ "$NODE_HEALTH" = "200" ]; then
    log_success "Node.js Backend: Healthy"
else
    log_error "Node.js Backend: Failed (HTTP $NODE_HEALTH)"
fi

# Check C# Backend
CSHARP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5291/health || echo "000")
if [ "$CSHARP_HEALTH" = "200" ]; then
    log_success "C# Backend: Healthy"
else
    log_error "C# Backend: Failed (HTTP $CSHARP_HEALTH)"
fi

# Check Redis
REDIS_HEALTH=$(docker exec movieweb-redis redis-cli ping 2>&1 | grep -c "PONG" || echo "0")
if [ "$REDIS_HEALTH" = "1" ]; then
    log_success "Redis: Healthy"
else
    log_error "Redis: Failed"
fi

# Overall health check
if [ "$NODE_HEALTH" = "200" ] && [ "$CSHARP_HEALTH" = "200" ] && [ "$REDIS_HEALTH" = "1" ]; then
    log_success "All services are healthy!"
else
    log_error "Some services failed health checks"
    log_warning "Rolling back..."
    docker-compose down
    # Restore from backup if needed
    exit 1
fi

# Clean up old images
log_warning "Cleaning up old Docker images..."
docker image prune -f || true

# Show status
log_warning "Deployment Status:"
docker-compose ps

# Show logs
log_warning "Recent logs:"
docker-compose logs --tail=20 backend

log_success "🎉 Deployment completed successfully!"
log_success "Backend is running at: http://localhost:5001"
log_success "Check logs with: docker-compose logs -f backend"

# Optional: Restart Nginx if needed
if systemctl is-active --quiet nginx; then
    log_warning "Reloading Nginx..."
    systemctl reload nginx
    log_success "Nginx reloaded"
fi

echo ""
echo "📊 System Status:"
echo "  - Docker: $(docker --version)"
echo "  - Containers: $(docker ps --format '{{.Names}}' | wc -l) running"
echo "  - Disk usage: $(df -h / | awk 'NR==2 {print $5}')"
echo "  - Memory: $(free -h | awk 'NR==2 {print $3 "/" $2}')"
