namespace PitLane.Api.Features.HistoricalSessions;

/// <summary>
/// Spaces requests to stay below the upstream limit observed from OpenF1.
/// Background downloads yield to requests someone is waiting on: they only
/// take a turn while no interactive request is queued.
/// </summary>
public sealed class OpenF1RequestGate(TimeProvider timeProvider)
{
    private static readonly TimeSpan MinimumRequestSpacing = TimeSpan.FromMilliseconds(450);
    private static readonly TimeSpan BackgroundPoll = TimeSpan.FromMilliseconds(100);
    private static readonly AsyncLocal<bool> BackgroundFlow = new();
    private readonly SemaphoreSlim semaphore = new(1, 1);
    private DateTimeOffset nextRequestAt;
    private int interactiveWaiting;

    /// <summary>Marks the current async flow (a background download) as low priority.</summary>
    public static void MarkBackground() => BackgroundFlow.Value = true;

    public async Task WaitTurnAsync(CancellationToken cancellationToken)
    {
        var background = BackgroundFlow.Value;
        if (!background) Interlocked.Increment(ref interactiveWaiting);
        try
        {
            while (background && Volatile.Read(ref interactiveWaiting) > 0)
            {
                await Task.Delay(BackgroundPoll, timeProvider, cancellationToken);
            }

            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var delay = nextRequestAt - timeProvider.GetUtcNow();
                if (delay > TimeSpan.Zero)
                {
                    await Task.Delay(delay, timeProvider, cancellationToken);
                }

                nextRequestAt = timeProvider.GetUtcNow() + MinimumRequestSpacing;
            }
            finally
            {
                semaphore.Release();
            }
        }
        finally
        {
            if (!background) Interlocked.Decrement(ref interactiveWaiting);
        }
    }
}
