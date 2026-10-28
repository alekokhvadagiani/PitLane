# Build with the host-native SDK and cross-publish for the requested image
# architecture (docker-deploy builds linux/amd64 on an ARM Mac).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /source
COPY src/PitLane.Api/PitLane.Api.csproj src/PitLane.Api/
RUN dotnet restore src/PitLane.Api/PitLane.Api.csproj -a "$TARGETARCH"
COPY src/PitLane.Api/ src/PitLane.Api/
RUN dotnet publish src/PitLane.Api/PitLane.Api.csproj -c Release -a "$TARGETARCH" --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
# curl backs the container health check.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
ENV Archive__Path=/data/archive
# Owned by the app user so a fresh named volume is writable.
RUN mkdir -p /data/archive && chown $APP_UID /data/archive
USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/health || exit 1
ENTRYPOINT ["dotnet", "PitLane.Api.dll"]
