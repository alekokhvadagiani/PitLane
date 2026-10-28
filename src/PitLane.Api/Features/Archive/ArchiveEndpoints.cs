using PitLane.Api.Features.HistoricalSessions;

namespace PitLane.Api.Features.Archive;

public sealed record ArchiveSummary(string Path, long TotalBytes, IReadOnlyList<SessionArchiveStatus> Sessions);

public sealed record SeasonArchiveRequest(int Year, string Include, IReadOnlyList<int> QueuedSessionKeys);

public static class ArchiveEndpoints
{
    public static IEndpointRouteBuilder MapArchive(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api").WithTags("Local archive");

        group.MapGet("/archive", async (SessionArchive archive, SessionDownloader downloader, CancellationToken cancellationToken) =>
            {
                var sessions = new List<SessionArchiveStatus>();
                foreach (var key in archive.SavedSessionKeys().Order())
                    sessions.Add(await downloader.GetStatusAsync(key, cancellationToken));
                return Results.Ok(new ArchiveSummary(archive.Root, sessions.Sum(item => item.SizeBytes), sessions));
            })
            .WithName("GetArchive")
            .WithSummary("List sessions stored on this machine")
            .Produces<ArchiveSummary>();

        group.MapGet("/sessions/{sessionKey:int}/archive", async (
                int sessionKey, SessionDownloader downloader, CancellationToken cancellationToken) =>
                sessionKey <= 0
                    ? InvalidSession()
                    : Results.Ok(await downloader.GetStatusAsync(sessionKey, cancellationToken)))
            .WithName("GetSessionArchiveStatus")
            .WithSummary("Whether a session is saved on this machine")
            .Produces<SessionArchiveStatus>()
            .ProducesValidationProblem();

        group.MapPost("/sessions/{sessionKey:int}/archive", async (
                int sessionKey, SessionDownloader downloader, CancellationToken cancellationToken) =>
                sessionKey <= 0
                    ? InvalidSession()
                    : Results.Accepted($"/api/sessions/{sessionKey}/archive", await downloader.EnqueueAsync(sessionKey, cancellationToken)))
            .WithName("SaveSessionArchive")
            .WithSummary("Save a finished session on this machine")
            .WithDescription("Queues a background download of every dataset for the session. Only sessions that finished at least six hours ago are saved.")
            .Produces<SessionArchiveStatus>(StatusCodes.Status202Accepted)
            .ProducesValidationProblem();

        group.MapPost("/archive/seasons/{year:int}", async (
                int year,
                string? include,
                ArchivedHistoricalSessionProvider provider,
                SessionDownloader downloader,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var currentYear = timeProvider.GetUtcNow().Year;
                if (year < 2023 || year > currentYear)
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["year"] = [$"Choose a year from 2023 to {currentYear}."]
                    });
                var scope = include ?? "races";
                if (scope is not ("races" or "all"))
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["include"] = ["Use \"races\" (races and sprints) or \"all\"."]
                    });

                try
                {
                    var queued = new List<int>();
                    var meetings = await provider.GetMeetingsAsync(year, cancellationToken);
                    foreach (var meeting in meetings.Items.Where(item => !item.IsCancelled && item.DateEnd < timeProvider.GetUtcNow()))
                    {
                        var sessions = await provider.GetSessionsAsync(meeting.MeetingKey, cancellationToken);
                        foreach (var session in sessions.Items.Where(item =>
                                     provider.IsFinished(item) &&
                                     (scope == "all" || item.SessionType.Equals("Race", StringComparison.OrdinalIgnoreCase))))
                        {
                            await downloader.EnqueueAsync(session.SessionKey, cancellationToken);
                            queued.Add(session.SessionKey);
                        }
                    }

                    return Results.Accepted("/api/archive", new SeasonArchiveRequest(year, scope, queued));
                }
                catch (HistoricalProviderException exception)
                {
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "The season calendar is temporarily unavailable", detail: exception.Message);
                }
            })
            .WithName("SaveSeasonArchive")
            .WithSummary("Save a season's finished races (or every session) on this machine")
            .WithDescription("include=races saves races and sprints; include=all also saves practice and qualifying.")
            .Produces<SeasonArchiveRequest>(StatusCodes.Status202Accepted)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        return endpoints;
    }

    private static IResult InvalidSession() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["sessionKey"] = ["Session key must be greater than zero."]
        });
}
