namespace PitLane.Api.Features.HistoricalSessions;

/// <summary>Spaces requests to stay below the upstream limit observed from OpenF1.</summary>
public sealed class OpenF1RequestGate(TimeProvider timeProvider)
{
    private static readonly TimeSpan MinimumRequestSpacing = TimeSpan.FromMilliseconds(450);
    private readonly SemaphoreSlim semaphore = new(1, 1);
    private DateTimeOffset nextRequestAt;

    public async Task WaitTurnAsync(CancellationToken cancellationToken)
    {
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
}
