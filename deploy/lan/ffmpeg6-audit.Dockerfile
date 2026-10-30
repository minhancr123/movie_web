FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
RUN apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ffmpeg=7:6.1.1-3ubuntu5 && rm -rf /var/lib/apt/lists/*
