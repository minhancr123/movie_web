cd /opt/cineon
dc() {
  docker compose -p cineon \
    --env-file /opt/cineon/.env.cineon \
    --env-file /opt/cineon/current.env \
    -f /opt/cineon/compose.cineon.yml "$@"
}
dc config --quiet
docker login
dc pull
dc up -d --wait --wait-timeout 180
dc ps
curl -fsS http://127.0.0.1:5001/health
curl -fsS http://127.0.0.1:3000/api/auth/providers
dc exec -T redis redis-cli ping
dc exec -T backend-node ffmpeg -version
