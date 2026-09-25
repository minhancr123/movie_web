docker compose -p cineon --env-file .env.cineon \
  --env-file next.env -f compose.cineon.yml config --quiet
docker compose -p cineon --env-file .env.cineon \
  --env-file next.env -f compose.cineon.yml pull
