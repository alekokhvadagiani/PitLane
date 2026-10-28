using System.Collections.Concurrent;
using System.Threading.Channels;
using PitLane.Api.Features.HistoricalSessions;

namespace PitLane.Api.Features.Archive;

/// <param name="State">not-saved, queued, saving, saved or failed.</param>
public sealed record SessionArchiveStatus(
    int SessionKey,
    string State,
    int CompletedSteps,
    int TotalSteps,
    DateTimeOffset? SavedAtUtc,
    long SizeBytes,
    string? Message);

public sealed record ArchiveManifest(
    DateTimeOffset SavedAtUtc,
    DateTimeOffset FromUtc,
    DateTimeOffset ToUtc,
    int Chunks);

/// <summary>
/// Saves whole finished sessions to the archive, one at a time, in the
/// background. Requests still pass the shared OpenF1 request gate, so a
/// download slows other OpenF1 calls but never breaks the rate limit.
/// </summary>
public sealed class SessionDownloader(
    IServiceScopeFactory scopes,
    SessionArchive archive,
    ILogger<SessionDownloader> logger) : BackgroundService
{
    /// <summary>Kept after the last recorded lap: the cool-down lap.</summary>
    private static readonly TimeSpan AfterFinish = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan LongestSession = TimeSpan.FromHours(5);
    private static readonly string[] WindowedDatasets = ["positions", "car-data", "intervals"];
    private const int DatasetSteps = 9;
    private const int ParallelRequests = 3;

    private readonly Channel<int> queue = Channel.CreateUnbounded<int>();
    private readonly ConcurrentDictionary<int, SessionArchiveStatus> jobs = new();

    public async Task<SessionArchiveStatus> EnqueueAsync(int sessionKey, CancellationToken cancellationToken)
    {
        var current = await GetStatusAsync(sessionKey, cancellationToken);
        if (current.State is "queued" or "saving" or "saved") return current;
        var queued = new SessionArchiveStatus(sessionKey, "queued", 0, 0, null, archive.SessionBytes(sessionKey), null);
        jobs[sessionKey] = queued;
        queue.Writer.TryWrite(sessionKey);
        return queued;
    }

    public async Task<SessionArchiveStatus> GetStatusAsync(int sessionKey, CancellationToken cancellationToken)
    {
        if (jobs.TryGetValue(sessionKey, out var job) && job.State != "saved")
            return job with { SizeBytes = archive.SessionBytes(sessionKey) };
        var manifest = await archive.ReadAsync<ArchiveManifest>(sessionKey, "manifest", cancellationToken);
        return manifest is null
            ? new SessionArchiveStatus(sessionKey, "not-saved", 0, 0, null, archive.SessionBytes(sessionKey), null)
            : new SessionArchiveStatus(sessionKey, "saved", 1, 1, manifest.SavedAtUtc, archive.SessionBytes(sessionKey), null);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var sessionKey in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await SaveAsync(sessionKey, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Saving session {SessionKey} failed", sessionKey);
                Update(sessionKey, status => status with { State = "failed", Message = FailureMessage(exception) });
            }
        }
    }

    private async Task SaveAsync(int sessionKey, CancellationToken cancellationToken)
    {
        // Everything this job fetches waits behind requests a viewer is waiting on.
        OpenF1RequestGate.MarkBackground();
        using var scope = scopes.CreateScope();
        var provider = scope.ServiceProvider.GetRequiredService<ArchivedHistoricalSessionProvider>();
        var session = await provider.GetSessionInfoAsync(sessionKey, cancellationToken);
        if (session is null)
            throw new InvalidOperationException("OpenF1 does not list this session.");
        if (!provider.IsFinished(session))
            throw new InvalidOperationException("Only sessions that finished at least six hours ago are saved.");

        Update(sessionKey, status => status with { State = "saving", TotalSteps = DatasetSteps });
        var laps = await Step(sessionKey, () => provider.GetSessionLapsAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetDriversAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetStintsAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetPitStopsAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetRaceControlAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetTeamRadioAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetSessionResultsAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetClassificationAsync(sessionKey, cancellationToken), cancellationToken);
        await Step(sessionKey, () => provider.GetWeatherAsync(sessionKey, cancellationToken), cancellationToken);

        var fromUtc = session.DateStart;
        var toUtc = RecordedEnd(session, laps.Items);
        var chunks = new List<DateTimeOffset>();
        for (var start = ArchivedHistoricalSessionProvider.ChunkStart(fromUtc); start < toUtc;
             start += ArchivedHistoricalSessionProvider.ChunkLength)
            chunks.Add(start);
        Update(sessionKey, status => status with { TotalSteps = DatasetSteps + chunks.Count * WindowedDatasets.Length });

        // Several requests in flight: each takes about a second to answer, while
        // the request gate still spaces their starts below OpenF1's limit.
        var work = chunks.SelectMany(chunk => WindowedDatasets.Select(dataset => (chunk, dataset)));
        await Parallel.ForEachAsync(
            work,
            new ParallelOptions { MaxDegreeOfParallelism = ParallelRequests, CancellationToken = cancellationToken },
            async (item, token) => await Step(sessionKey, async () =>
            {
                await provider.EnsureChunkAsync(sessionKey, item.dataset, item.chunk, token);
                return true;
            }, token));

        var savedAt = DateTimeOffset.UtcNow;
        await archive.WriteAsync(sessionKey, "manifest", new ArchiveManifest(savedAt, fromUtc, toUtc, chunks.Count), cancellationToken);
        Update(sessionKey, status => status with
        {
            State = "saved",
            CompletedSteps = status.TotalSteps,
            SavedAtUtc = savedAt,
            SizeBytes = archive.SessionBytes(sessionKey),
        });
        logger.LogInformation("Saved session {SessionKey}: {Chunks} chunks, {Bytes} bytes", sessionKey, chunks.Count, archive.SessionBytes(sessionKey));
    }

    /// <summary>
    /// The scheduled end, extended past it when laps were recorded later (a
    /// red-flag delay), plus the cool-down lap. Never more than five hours.
    /// </summary>
    private static DateTimeOffset RecordedEnd(HistoricalSession session, IReadOnlyList<HistoricalLap> laps)
    {
        var lastLapEnd = laps
            .Where(lap => lap.DateStart is not null && lap.LapDuration is > 0)
            .Select(lap => lap.DateStart!.Value + TimeSpan.FromSeconds(lap.LapDuration!.Value))
            .DefaultIfEmpty(session.DateStart)
            .Max();
        var end = new[] { session.DateEnd ?? session.DateStart, lastLapEnd + AfterFinish }.Max();
        var cap = session.DateStart + LongestSession;
        return end < cap ? end : cap;
    }

    /// <summary>Runs one download step, waiting and retrying when OpenF1 is busy.</summary>
    private async Task<T> Step<T>(int sessionKey, Func<Task<T>> work, CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                var result = await work();
                Update(sessionKey, status => status with { CompletedSteps = status.CompletedSteps + 1 });
                return result;
            }
            catch (HistoricalProviderException) when (attempt < 4)
            {
                await Task.Delay(TimeSpan.FromSeconds(5 * attempt), cancellationToken);
            }
        }
    }

    private void Update(int sessionKey, Func<SessionArchiveStatus, SessionArchiveStatus> change) =>
        jobs.AddOrUpdate(
            sessionKey,
            key => change(new SessionArchiveStatus(key, "queued", 0, 0, null, 0, null)),
            (_, status) => change(status));

    private static string FailureMessage(Exception exception) => exception switch
    {
        InvalidOperationException or HistoricalProviderException => exception.Message,
        _ => "Saving stopped unexpectedly. Already saved parts are kept; try again.",
    };
}
