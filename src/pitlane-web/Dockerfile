# The site is static, so build it natively; only the nginx stage follows the
# platform requested by docker buildx.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY src/pitlane-web/package*.json ./
RUN npm ci
COPY src/pitlane-web/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY src/pitlane-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
