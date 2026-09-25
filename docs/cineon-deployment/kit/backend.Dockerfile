# syntax=docker/dockerfile:1
FROM node:24-alpine
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 5001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
