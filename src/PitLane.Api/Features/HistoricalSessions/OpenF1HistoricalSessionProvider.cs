using System.Net.Http.Json;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace PitLane.Api.Features.HistoricalSessions;

public sealed class OpenF1HistoricalSessionProvider(
    HttpClient httpClient,
    IMemoryCache cache,
    TimeProvider timeProvider,
    OpenF1RequestGate requestGate) : IHistoricalSessionProvider
{
    private const string Source = "OpenF1";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

    public Task<HistoricalCatalog<HistoricalMeeting>> GetMeetingsAsync(
        int year,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:meetings:{year}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Meeting>($"meetings?year={year}", cancellationToken);
            var meetings = records
                .Where(item => item.MeetingKey > 0 && item.Year == year &&
                    !string.IsNullOrWhiteSpace(item.MeetingName))
                .OrderBy(item => item.DateStart)
                .Select(item => new HistoricalMeeting(
                    item.MeetingKey,
                    item.MeetingName,
                    item.Location,
                    item.CountryName,
                    item.CircuitShortName,
                    item.Year,
                    item.DateStart,
                    item.DateEnd,
                    item.IsCancelled))
                .ToArray();

            return new HistoricalCatalog<HistoricalMeeting>(Source, timeProvider.GetUtcNow(), meetings);
        })!;

    public Task<HistoricalCatalog<HistoricalSession>> GetSessionsAsync(
        int meetingKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:sessions:{meetingKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Session>($"sessions?meeting_key={meetingKey}", cancellationToken);
            var sessions = records
                .Where(item => item.SessionKey > 0 && item.MeetingKey == meetingKey &&
                    !string.IsNullOrWhiteSpace(item.SessionName))
                .OrderBy(item => item.DateStart)
                .Select(item => new HistoricalSession(
                    item.SessionKey,
                    item.MeetingKey,
                    item.SessionName,
                    item.SessionType,
                    item.DateStart,
                    item.DateEnd))
                .ToArray();

            return new HistoricalCatalog<HistoricalSession>(Source, timeProvider.GetUtcNow(), sessions);
        })!;

    public Task<HistoricalCatalog<HistoricalWeatherObservation>> GetWeatherAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:weather:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Weather>($"weather?session_key={sessionKey}", cancellationToken);
            var observations = records
                .Where(item => item.SessionKey == sessionKey)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalWeatherObservation(
                    item.Date,
                    item.AirTemperature,
                    item.TrackTemperature,
                    item.Humidity,
                    item.Pressure,
                    item.Rainfall,
                    item.WindSpeed,
                    item.WindDirection))
                .ToArray();

            return new HistoricalCatalog<HistoricalWeatherObservation>(Source, timeProvider.GetUtcNow(), observations);
        })!;

    public Task<HistoricalCatalog<HistoricalDriver>> GetDriversAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:drivers:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Driver>($"drivers?session_key={sessionKey}", cancellationToken);
            var drivers = records
                .Where(item => item.DriverNumber > 0 && !string.IsNullOrWhiteSpace(item.FullName))
                .GroupBy(item => item.DriverNumber)
                .Select(group => group.First())
                .OrderBy(item => item.DriverNumber)
                .Select(item => new HistoricalDriver(
                    item.DriverNumber,
                    item.FullName,
                    item.NameAcronym,
                    item.TeamName,
                    item.TeamColour))
                .ToArray();

            return new HistoricalCatalog<HistoricalDriver>(Source, timeProvider.GetUtcNow(), drivers);
        })!;

    public Task<HistoricalCatalog<HistoricalLap>> GetLapsAsync(
        int sessionKey,
        int driverNumber,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:laps:{sessionKey}:{driverNumber}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Lap>(
                $"laps?session_key={sessionKey}&driver_number={driverNumber}", cancellationToken);
            var laps = records
                .Where(item => item.LapNumber > 0)
                .OrderBy(item => item.LapNumber)
                .Select(item => new HistoricalLap(
                    item.LapNumber,
                    item.DateStart,
                    item.LapDuration,
                    item.Sector1Duration,
                    item.Sector2Duration,
                    item.Sector3Duration,
                    item.IsPitOutLap,
                    item.DriverNumber))
                .ToArray();

            return new HistoricalCatalog<HistoricalLap>(Source, timeProvider.GetUtcNow(), laps);
        })!;

    public Task<HistoricalCatalog<HistoricalLap>> GetSessionLapsAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:session-laps:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Lap>($"laps?session_key={sessionKey}", cancellationToken);
            var laps = records
                .Where(item => item.LapNumber > 0 && item.DriverNumber > 0)
                .OrderBy(item => item.DateStart)
                .ThenBy(item => item.LapNumber)
                .Select(item => new HistoricalLap(
                    item.LapNumber, item.DateStart, item.LapDuration, item.Sector1Duration,
                    item.Sector2Duration, item.Sector3Duration, item.IsPitOutLap, item.DriverNumber))
                .ToArray();
            return new HistoricalCatalog<HistoricalLap>(Source, timeProvider.GetUtcNow(), laps);
        })!;

    public Task<HistoricalCatalog<HistoricalStint>> GetStintsAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:stints:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Stint>($"stints?session_key={sessionKey}", cancellationToken);
            var stints = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber > 0)
                .OrderBy(item => item.DriverNumber)
                .ThenBy(item => item.StintNumber)
                .Select(item => new HistoricalStint(item.DriverNumber, item.StintNumber,
                    item.Compound, item.LapStart, item.LapEnd, item.TyreAgeAtStart))
                .ToArray();
            return new HistoricalCatalog<HistoricalStint>(Source, timeProvider.GetUtcNow(), stints);
        })!;

    public Task<HistoricalCatalog<HistoricalPitStop>> GetPitStopsAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:pit-stops:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1PitStop>($"pit?session_key={sessionKey}", cancellationToken);
            var stops = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber > 0)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalPitStop(item.Date, item.DriverNumber, item.LapNumber, item.LaneDuration))
                .ToArray();
            return new HistoricalCatalog<HistoricalPitStop>(Source, timeProvider.GetUtcNow(), stops);
        })!;

    public Task<HistoricalCatalog<HistoricalSessionResult>> GetSessionResultsAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:session-results:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1SessionResult>($"session_result?session_key={sessionKey}", cancellationToken);
            var results = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber > 0)
                .GroupBy(item => item.DriverNumber)
                .Select(group => group.Last())
                .OrderBy(item => item.DriverNumber)
                .Select(item => new HistoricalSessionResult(item.DriverNumber, item.Dnf, item.Dns,
                    item.Dsq, item.Position, item.NumberOfLaps))
                .ToArray();
            return new HistoricalCatalog<HistoricalSessionResult>(Source, timeProvider.GetUtcNow(), results);
        })!;

    public Task<HistoricalCatalog<HistoricalPositionSample>> GetPositionsAsync(
        int sessionKey,
        int driverNumber,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        if (toUtc <= fromUtc || toUtc - fromUtc > TimeSpan.FromMinutes(3))
        {
            throw new ArgumentOutOfRangeException(nameof(toUtc), "Position requests must cover no more than three minutes.");
        }

        var from = fromUtc.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        var to = toUtc.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        var fromFilter = Uri.EscapeDataString(from);
        var toFilter = Uri.EscapeDataString(to);
        var cacheKey = $"openf1:positions:{sessionKey}:{driverNumber}:{from}:{to}";

        return cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Position>(
                $"location?session_key={sessionKey}&driver_number={driverNumber}&date%3E%3D{fromFilter}&date%3C{toFilter}",
                cancellationToken);
            var positions = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber == driverNumber &&
                    item.Date >= fromUtc && item.Date < toUtc)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalPositionSample(item.Date, item.X, item.Y, item.Z))
                .ToArray();

            return new HistoricalCatalog<HistoricalPositionSample>(Source, timeProvider.GetUtcNow(), positions);
        })!;
    }

    public Task<HistoricalCatalog<HistoricalPositionSample>> GetSessionPositionsAsync(
        int sessionKey,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        ValidateWindow(fromUtc, toUtc);
        var from = FormatDate(fromUtc);
        var to = FormatDate(toUtc);
        var path = $"location?session_key={sessionKey}&date%3E%3D{Uri.EscapeDataString(from)}&date%3C{Uri.EscapeDataString(to)}";
        return cache.GetOrCreateAsync($"openf1:positions:all:{sessionKey}:{from}:{to}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Position>(path, cancellationToken);
            var positions = records
                .Where(item => item.SessionKey == sessionKey && item.Date >= fromUtc && item.Date < toUtc)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalPositionSample(item.Date, item.X, item.Y, item.Z, item.DriverNumber))
                .ToArray();
            return new HistoricalCatalog<HistoricalPositionSample>(Source, timeProvider.GetUtcNow(), positions);
        })!;
    }

    public Task<HistoricalCatalog<HistoricalClassificationChange>> GetClassificationAsync(
        int sessionKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:classification:{sessionKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Classification>(
                $"position?session_key={sessionKey}", cancellationToken);
            var changes = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber > 0 && item.Position > 0)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalClassificationChange(item.Date, item.DriverNumber, item.Position))
                .ToArray();
            return new HistoricalCatalog<HistoricalClassificationChange>(Source, timeProvider.GetUtcNow(), changes);
        })!;

    public Task<HistoricalCatalog<HistoricalCarSample>> GetCarDataAsync(
        int sessionKey,
        int driverNumber,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken)
    {
        ValidateWindow(fromUtc, toUtc);
        var from = FormatDate(fromUtc);
        var to = FormatDate(toUtc);
        var path = $"car_data?session_key={sessionKey}&driver_number={driverNumber}&date%3E%3D{Uri.EscapeDataString(from)}&date%3C{Uri.EscapeDataString(to)}";
        return cache.GetOrCreateAsync($"openf1:car-data:{sessionKey}:{driverNumber}:{from}:{to}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1CarData>(path, cancellationToken);
            var samples = records
                .Where(item => item.SessionKey == sessionKey && item.DriverNumber == driverNumber && item.Date >= fromUtc && item.Date < toUtc)
                .OrderBy(item => item.Date)
                .Select(item => new HistoricalCarSample(item.Date, item.DriverNumber, item.Speed,
                    item.Throttle, item.Brake, item.Rpm, item.Gear, item.Drs))
                .ToArray();
            return new HistoricalCatalog<HistoricalCarSample>(Source, timeProvider.GetUtcNow(), samples);
        })!;
    }

    private static void ValidateWindow(DateTimeOffset fromUtc, DateTimeOffset toUtc)
    {
        if (toUtc <= fromUtc || toUtc - fromUtc > TimeSpan.FromMinutes(3))
            throw new ArgumentOutOfRangeException(nameof(toUtc), "Position and telemetry requests must cover no more than three minutes.");
    }

    private static string FormatDate(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private async Task<IReadOnlyList<T>> FetchAsync<T>(string path, CancellationToken cancellationToken)
    {
        try
        {
            await requestGate.WaitTurnAsync(cancellationToken);
            using var response = await httpClient.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    await using var errorStream = await response.Content.ReadAsStreamAsync(cancellationToken);
                    using var error = await JsonDocument.ParseAsync(errorStream, cancellationToken: cancellationToken);
                    if (error.RootElement.TryGetProperty("detail", out var detail) &&
                        detail.GetString() == "No results found.")
                    {
                        return Array.Empty<T>();
                    }
                }

                if ((int)response.StatusCode == 429)
                {
                    var retryAfter = response.Headers.RetryAfter?.Delta;
                    var retryMessage = retryAfter is null
                        ? "Wait briefly before trying again."
                        : $"Wait {Math.Ceiling(retryAfter.Value.TotalSeconds)} seconds before trying again.";
                    throw new HistoricalProviderException($"OpenF1 is rate limiting requests. {retryMessage}");
                }

                throw new HistoricalProviderException("OpenF1 could not provide historical data. Try again shortly.");
            }

            return await response.Content.ReadFromJsonAsync<List<T>>(cancellationToken: cancellationToken) ?? [];
        }
        catch (HistoricalProviderException)
        {
            throw;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HistoricalProviderException("OpenF1 took too long to return historical data. Try again.");
        }
        catch (HttpRequestException)
        {
            throw new HistoricalProviderException("OpenF1 is unavailable. Check your connection and try again.");
        }
        catch (JsonException)
        {
            throw new HistoricalProviderException("OpenF1 returned data in an unexpected format.");
        }
    }

    private sealed record OpenF1Meeting(
        [property: JsonPropertyName("meeting_key")] int MeetingKey,
        [property: JsonPropertyName("meeting_name")] string MeetingName,
        [property: JsonPropertyName("location")] string Location,
        [property: JsonPropertyName("country_name")] string CountryName,
        [property: JsonPropertyName("circuit_short_name")] string CircuitShortName,
        [property: JsonPropertyName("year")] int Year,
        [property: JsonPropertyName("date_start")] DateTimeOffset DateStart,
        [property: JsonPropertyName("date_end")] DateTimeOffset DateEnd,
        [property: JsonPropertyName("is_cancelled")] bool IsCancelled);

    private sealed record OpenF1Session(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("meeting_key")] int MeetingKey,
        [property: JsonPropertyName("session_name")] string SessionName,
        [property: JsonPropertyName("session_type")] string SessionType,
        [property: JsonPropertyName("date_start")] DateTimeOffset DateStart,
        [property: JsonPropertyName("date_end")] DateTimeOffset? DateEnd);

    private sealed record OpenF1Weather(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("date")] DateTimeOffset Date,
        [property: JsonPropertyName("air_temperature")] double? AirTemperature,
        [property: JsonPropertyName("track_temperature")] double? TrackTemperature,
        [property: JsonPropertyName("humidity")] double? Humidity,
        [property: JsonPropertyName("pressure")] double? Pressure,
        [property: JsonPropertyName("rainfall")] int? Rainfall,
        [property: JsonPropertyName("wind_speed")] double? WindSpeed,
        [property: JsonPropertyName("wind_direction")] int? WindDirection);

    private sealed record OpenF1Driver(
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("full_name")] string FullName,
        [property: JsonPropertyName("name_acronym")] string NameAcronym,
        [property: JsonPropertyName("team_name")] string TeamName,
        [property: JsonPropertyName("team_colour")] string TeamColour);

    private sealed record OpenF1Lap(
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("lap_number")] int LapNumber,
        [property: JsonPropertyName("date_start")] DateTimeOffset? DateStart,
        [property: JsonPropertyName("lap_duration")] double? LapDuration,
        [property: JsonPropertyName("duration_sector_1")] double? Sector1Duration,
        [property: JsonPropertyName("duration_sector_2")] double? Sector2Duration,
        [property: JsonPropertyName("duration_sector_3")] double? Sector3Duration,
        [property: JsonPropertyName("is_pit_out_lap")] bool? IsPitOutLap);

    private sealed record OpenF1Stint(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("stint_number")] int StintNumber,
        [property: JsonPropertyName("compound")] string? Compound,
        [property: JsonPropertyName("lap_start")] int? LapStart,
        [property: JsonPropertyName("lap_end")] int? LapEnd,
        [property: JsonPropertyName("tyre_age_at_start")] int? TyreAgeAtStart);

    private sealed record OpenF1PitStop(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("date")] DateTimeOffset Date,
        [property: JsonPropertyName("lap_number")] int? LapNumber,
        [property: JsonPropertyName("lane_duration")] double? LaneDuration);

    private sealed record OpenF1SessionResult(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("dnf")] bool Dnf,
        [property: JsonPropertyName("dns")] bool Dns,
        [property: JsonPropertyName("dsq")] bool Dsq,
        [property: JsonPropertyName("position")] int? Position,
        [property: JsonPropertyName("number_of_laps")] int? NumberOfLaps);

    private sealed record OpenF1Position(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("date")] DateTimeOffset Date,
        [property: JsonPropertyName("x")] double? X,
        [property: JsonPropertyName("y")] double? Y,
        [property: JsonPropertyName("z")] double? Z);

    private sealed record OpenF1Classification(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("date")] DateTimeOffset Date,
        [property: JsonPropertyName("position")] int Position);

    private sealed record OpenF1CarData(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("driver_number")] int DriverNumber,
        [property: JsonPropertyName("date")] DateTimeOffset Date,
        [property: JsonPropertyName("speed")] int? Speed,
        [property: JsonPropertyName("throttle")] int? Throttle,
        [property: JsonPropertyName("brake")] int? Brake,
        [property: JsonPropertyName("rpm")] int? Rpm,
        [property: JsonPropertyName("n_gear")] int? Gear,
        [property: JsonPropertyName("drs")] int? Drs);
}
