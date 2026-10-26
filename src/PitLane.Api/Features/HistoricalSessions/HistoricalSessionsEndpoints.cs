namespace PitLane.Api.Features.HistoricalSessions;

public static class HistoricalSessionsEndpoints
{
    public static IEndpointRouteBuilder MapHistoricalSessions(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api").WithTags("Historical sessions");

        group.MapGet("/meetings", async (
                int year,
                IHistoricalSessionProvider provider,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var currentYear = timeProvider.GetUtcNow().Year;
                if (year is < 2023 || year > currentYear)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["year"] = [$"Choose a year from 2023 to {currentYear}."]
                    });
                }

                try
                {
                    return Results.Ok(await provider.GetMeetingsAsync(year, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Historical sessions are temporarily unavailable", detail: exception.Message);
                }
            })
            .WithName("GetHistoricalMeetings")
            .WithSummary("List historical Grand Prix meetings for a year")
            .WithDescription("Loads the official OpenF1 meeting catalog. This lists event metadata and does not imply replay data exists for each session.")
            .Produces<HistoricalCatalog<HistoricalMeeting>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/meetings/{meetingKey:int}/sessions", async (
                int meetingKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (meetingKey <= 0)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["meetingKey"] = ["Meeting key must be greater than zero."]
                    });
                }

                try
                {
                    return Results.Ok(await provider.GetSessionsAsync(meetingKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Historical sessions are temporarily unavailable", detail: exception.Message);
                }
            })
            .WithName("GetHistoricalMeetingSessions")
            .WithSummary("List sessions for a historical meeting")
            .WithDescription("Loads session names and UTC times from OpenF1. Position, timing, and telemetry coverage is not checked here.")
            .Produces<HistoricalCatalog<HistoricalSession>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        return endpoints;
    }
}
