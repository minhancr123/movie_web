cp next.env current.env
dc up -d --wait --wait-timeout 180
bash kit/smoke.sh https://cineon.me
dc ps
