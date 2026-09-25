sudo journalctl -u caddy -n 100 --no-pager
dc logs --tail 100 backend-node frontend backend-node-worker
docker stats --no-stream
docker system df
df -h /
df -i /
vmstat 1 5
dc exec -T redis redis-cli INFO memory
dc exec -T redis redis-cli CONFIG GET maxmemory-policy
docker inspect --format '{{.State.OOMKilled}} {{.RestartCount}}' \
  "$(dc ps -q backend-node)"
