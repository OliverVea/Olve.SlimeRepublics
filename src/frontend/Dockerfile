# Web image: the built client behind nginx, which also proxies /ws to the game server so the
# page and its socket share one origin. Built by .pipelines/scripts/build-web.sh (Kaniko),
# context = src/frontend. The generated FlatBuffers client is committed, so no flatc here.
FROM node:24-alpine AS build
WORKDIR /fe
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# A bare path: connection.ts resolves it against the page's own origin (see nginx.conf).
ENV VITE_WS_URL=/ws
RUN npm run build

# Unprivileged variant: listens on 8080 and runs as uid 101, so the pod can drop root.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /fe/dist /usr/share/nginx/html
