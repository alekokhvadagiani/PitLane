using Microsoft.Extensions.Caching.Memory;
using PitLane.Api.Features.HistoricalSessions;

namespace PitLane.Api.Features.Archive;

/// <summary>
/// Serves finished sessions from the disk archive and falls back to OpenF1.
/// Per-session datasets are stored whole. Positions, telemetry and gaps are
/// stored for every car in fixed three-minute chunks aligned to the clock, so
/// any later window (for any driver) is answered from disk. Catalogs, and
/// sessions still running or finished less than six hours ago, are not stored,
/// because OpenF1 still revises them.
/// </summary>
public sealed class ArchivedHistoricalSessionProvider(
    OpenF1HistoricalSessionProvider openF1,
    SessionArchive archive,
    IMemoryCache cache,
    TimeProvider timeProvider) : IHistoricalSessionProvider
{
    public static readonly TimeSpan ChunkLength = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan SettleTime = TimeSpan.FromHours(6);
    private static readonly TimeSpan MemoryTime = TimeSpan.FromMinutes(10);

    public Task<HistoricalCatalog<HistoricalMeeting>> GetMeetingsAsync(int year, CancellationToken cancellationToken) =>
        openF1.GetMeetingsAsync(year, cancellationToken);

    public Task<HistoricalCatalog<HistoricalSession>> GetSessionsAsync(int meetingKey, CancellationToken cancellationToken) =>
        openF1.GetSessionsAsync(meetingKey, cancellationToken);

    /// <summary>The session's schedule, from disk when saved.</summary>
    public async Task<HistoricalSession?> GetSessionInfoAsync(int sessionKey, CancellationToken cancellationToken)
    {
        var saved = await archive.ReadAsync<HistoricalSession>(sessionKey, "session", cancellationToken);
        if (saved is not null) return saved;
        var session = await openF1.GetSessionAsync(sessionKey, cancellationToken);
        if (session is not null && IsFinished(session))
            await archive.WriteAsync(sessionKey, "session", session, cancellationToken);
        return session;
    }

    public bool IsFinished(HistoricalSession session) =>
        session.DateEnd is { } end && timeProvider.GetUtcNow() > end + SettleTime;

    public Task<HistoricalCatalog<HistoricalWeatherObservation>> GetWeatherAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "weather", openF1.GetWeatherAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalDriver>> GetDriversAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "drivers", openF1.GetDriversAsync, cancellationToken);

    public async Task<HistoricalCatalog<HistoricalLap>> GetLapsAsync(int sessionKey, int driverNumber, CancellationToken cancellationToken)
    {
        var laps = await GetSessionLapsAsync(sessionKey, cancellationToken);
        return laps with
        {
            Items = laps.Items.Where(lap => lap.DriverNumber == driverNumber).OrderBy(lap => lap.LapNumber).ToArray()
        };
    }

    public Task<HistoricalCatalog<HistoricalLap>> GetSessionLapsAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "laps", openF1.GetSessionLapsAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalStint>> GetStintsAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "stints", openF1.GetStintsAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalPitStop>> GetPitStopsAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "pit-stops", openF1.GetPitStopsAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalRaceControlMessage>> GetRaceControlAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "race-control", openF1.GetRaceControlAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalTeamRadio>> GetTeamRadioAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "team-radio", openF1.GetTeamRadioAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalSessionResult>> GetSessionResultsAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "results", openF1.GetSessionResultsAsync, cancellationToken);

    public Task<HistoricalCatalog<HistoricalClassificationChange>> GetClassificationAsync(int sessionKey, CancellationToken cancellationToken) =>
        DatasetAsync(sessionKey, "classification", openF1.GetClassificationAsync, cancellationToken);

    public async Task<HistoricalCatalog<HistoricalPositionSample>> GetPositionsAsync(
        int sessionKey, int driverNumber, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken)
    {
        var all = await GetSessionPositionsAsync(sessionKey, fromUtc, toUtc, cancellationToken);
        return all with { Items = all.Items.Where(sample => sample.DriverNumber == driverNumber).ToArray() };
    }

    public Task<HistoricalCatalog<HistoricalPositionSample>> GetSessionPositionsAsync(
        int sessionKey, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken) =>
        WindowAsync(
            sessionKey, "positions", fromUtc, toUtc,
            openF1.LoadSessionPositionsAsync,
            sample => sample.Date,
            samples => samples.OrderBy(sample => sample.Date),
            cancellationToken);

    public Task<HistoricalCatalog<HistoricalInterval>> GetIntervalsAsync(
        int sessionKey, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken) =>
        WindowAsync(
            sessionKey, "intervals", fromUtc, toUtc,
            openF1.LoadIntervalsAsync,
            item => item.Date,
            items => items.OrderBy(item => item.DriverNumber).ThenBy(item => item.Date),
            cancellationToken);

    public async Task<HistoricalCatalog<HistoricalCarSample>> GetCarDataAsync(
        int sessionKey, int driverNumber, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken)
    {
        var all = await WindowAsync(
            sessionKey, "car-data", fromUtc, toUtc,
            AllCarData,
            sample => sample.Date,
            samples => samples.OrderBy(sample => sample.Date),
            cancellationToken);
        return all with { Items = all.Items.Where(sample => sample.DriverNumber == driverNumber).ToArray() };
    }

    /// <summary>
    /// Saves one chunk of a windowed dataset if it is not on disk yet, without
    /// keeping it in memory. Used by the background downloader.
    /// </summary>
    public async Task EnsureChunkAsync(int sessionKey, string dataset, DateTimeOffset chunkStart, CancellationToken cancellationToken)
    {
        var name = ChunkName(dataset, chunkStart);
        if (archive.Exists(sessionKey, name)) return;
        _ = dataset switch
        {
            "positions" => await FetchChunkAsync(sessionKey, name, chunkStart, openF1.LoadSessionPositionsAsync, cancellationToken) as object,
            "car-data" => await FetchChunkAsync(sessionKey, name, chunkStart, AllCarData, cancellationToken),
            "intervals" => await FetchChunkAsync(sessionKey, name, chunkStart, openF1.LoadIntervalsAsync, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(dataset), dataset, "Unknown windowed dataset."),
        };
    }

    public static DateTimeOffset ChunkStart(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % ChunkLength.Ticks, TimeSpan.Zero);

    private Task<HistoricalCatalog<HistoricalCarSample>> AllCarData(
        int sessionKey, DateTimeOffset fromUtc, DateTimeOffset toUtc, CancellationToken cancellationToken) =>
        openF1.LoadCarDataAsync(sessionKey, null, fromUtc, toUtc, cancellationToken);

    private static string ChunkName(string dataset, DateTimeOffset chunkStart) =>
        $"{dataset}/{chunkStart.ToUnixTimeMilliseconds()}";

    private Task<HistoricalCatalog<T>> DatasetAsync<T>(
        int sessionKey,
        string name,
        Func<int, CancellationToken, Task<HistoricalCatalog<T>>> fetch,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"archive:{name}:{sessionKey}", async entry =>
        {
            var saved = await archive.ReadAsync<HistoricalCatalog<T>>(sessionKey, name, cancellationToken);
            if (saved is not null)
            {
                entry.SlidingExpiration = MemoryTime;
                return saved;
            }

            entry.AbsoluteExpirationRelativeToNow = MemoryTime;
            return await archive.ShareAsync($"{sessionKey}/{name}", async () =>
            {
                var fresh = await fetch(sessionKey, CancellationToken.None);
                if (await ShouldStoreAsync(sessionKey))
                    await archive.WriteAsync(sessionKey, name, fresh, CancellationToken.None);
                return fresh;
            }, cancellationToken);
        })!;

    private async Task<HistoricalCatalog<T>> WindowAsync<T>(
        int sessionKey,
        string dataset,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        Func<int, DateTimeOffset, DateTimeOffset, CancellationToken, Task<HistoricalCatalog<T>>> fetch,
        Func<T, DateTimeOffset> dateOf,
        Func<IEnumerable<T>, IEnumerable<T>> order,
        CancellationToken cancellationToken)
    {
        var items = new List<T>();
        DateTimeOffset? retrieved = null;
        for (var start = ChunkStart(fromUtc); start < toUtc; start += ChunkLength)
        {
            var chunk = await ChunkAsync(sessionKey, dataset, start, fetch, cancellationToken);
            items.AddRange(chunk.Items.Where(item => dateOf(item) >= fromUtc && dateOf(item) < toUtc));
            retrieved = retrieved is null || chunk.RetrievedAtUtc < retrieved ? chunk.RetrievedAtUtc : retrieved;
        }

        return new HistoricalCatalog<T>("OpenF1", retrieved ?? timeProvider.GetUtcNow(), order(items).ToArray());
    }

    private Task<HistoricalCatalog<T>> ChunkAsync<T>(
        int sessionKey,
        string dataset,
        DateTimeOffset chunkStart,
        Func<int, DateTimeOffset, DateTimeOffset, CancellationToken, Task<HistoricalCatalog<T>>> fetch,
        CancellationToken cancellationToken)
    {
        var name = ChunkName(dataset, chunkStart);
        return cache.GetOrCreateAsync($"archive:{sessionKey}:{name}", async entry =>
        {
            entry.SlidingExpiration = MemoryTime;
            return await archive.ReadAsync<HistoricalCatalog<T>>(sessionKey, name, cancellationToken)
                ?? await FetchChunkAsync(sessionKey, name, chunkStart, fetch, cancellationToken);
        })!;
    }

    private Task<HistoricalCatalog<T>> FetchChunkAsync<T>(
        int sessionKey,
        string name,
        DateTimeOffset chunkStart,
        Func<int, DateTimeOffset, DateTimeOffset, CancellationToken, Task<HistoricalCatalog<T>>> fetch,
        CancellationToken cancellationToken) =>
        archive.ShareAsync($"{sessionKey}/{name}", async () =>
        {
            var fresh = await fetch(sessionKey, chunkStart, chunkStart + ChunkLength, CancellationToken.None);
            if (await ShouldStoreAsync(sessionKey))
                await archive.WriteAsync(sessionKey, name, fresh, CancellationToken.None);
            return fresh;
        }, cancellationToken);

    private async Task<bool> ShouldStoreAsync(int sessionKey)
    {
        var session = await GetSessionInfoAsync(sessionKey, CancellationToken.None);
        return session is not null && IsFinished(session);
    }
}
