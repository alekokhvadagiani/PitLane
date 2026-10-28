FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY src/PitLane.Api/ src/PitLane.Api/
RUN dotnet publish src/PitLane.Api/PitLane.Api.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
ENV Archive__Path=/data/archive
# Owned by the app user so a fresh named volume is writable.
RUN mkdir -p /data/archive && chown $APP_UID /data/archive
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "PitLane.Api.dll"]
