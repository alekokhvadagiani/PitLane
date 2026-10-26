FROM node:24-alpine AS build
WORKDIR /app
COPY src/pitlane-web/package*.json ./
RUN npm ci
COPY src/pitlane-web/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY src/pitlane-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
