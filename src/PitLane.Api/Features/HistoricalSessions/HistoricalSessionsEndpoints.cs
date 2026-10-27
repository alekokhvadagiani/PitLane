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

        group.MapGet("/sessions/{sessionKey:int}/weather", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["sessionKey"] = ["Session key must be greater than zero."]
                    });
                }

                try
                {
                    return Results.Ok(await provider.GetWeatherAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Session weather is temporarily unavailable", detail: exception.Message);
                }
            })
            .WithName("GetHistoricalSessionWeather")
            .WithSummary("List historical weather observations for a session")
            .WithDescription("Returns timestamped OpenF1 weather observations. The feed may be empty or contain missing measurements.")
            .Produces<HistoricalCatalog<HistoricalWeatherObservation>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/drivers", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0)
                {
                    return Invalid("sessionKey", "Session key must be greater than zero.");
                }

                try
                {
                    return Results.Ok(await provider.GetDriversAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session drivers are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalSessionDrivers")
            .WithSummary("List drivers in a historical session")
            .Produces<HistoricalCatalog<HistoricalDriver>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/laps", async (
                int sessionKey,
                int driverNumber,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                if (driverNumber is < 1 or > 99) return Invalid("driverNumber", "Driver number must be between 1 and 99.");

                try
                {
                    return Results.Ok(await provider.GetLapsAsync(sessionKey, driverNumber, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session laps are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalDriverLaps")
            .WithSummary("List lap timing for one driver in a historical session")
            .Produces<HistoricalCatalog<HistoricalLap>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/all-laps", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                try
                {
                    return Results.Ok(await provider.GetSessionLapsAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session lap data is temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalSessionLaps")
            .WithSummary("List timestamped lap data for all session drivers")
            .Produces<HistoricalCatalog<HistoricalLap>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/stints", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                try
                {
                    return Results.Ok(await provider.GetStintsAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session tyre stints are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalSessionStints")
            .WithSummary("List tyre compound stints for session drivers")
            .Produces<HistoricalCatalog<HistoricalStint>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/pit-stops", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                try
                {
                    return Results.Ok(await provider.GetPitStopsAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session pit lane records are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalSessionPitStops")
            .WithSummary("List recorded pit lane visits")
            .WithDescription("Returns timestamped pit events and recorded lane duration. OpenF1 does not document whether the event timestamp is lane entry or exit; replay's PIT LANE interval is therefore an estimate.")
            .Produces<HistoricalCatalog<HistoricalPitStop>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/results", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                try
                {
                    return Results.Ok(await provider.GetSessionResultsAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session results are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalSessionResults")
            .WithSummary("List final session classifications and retirement flags")
            .WithDescription("Returns final DNF/DNS/DSQ results where published; these flags are not timestamped retirement events.")
            .Produces<HistoricalCatalog<HistoricalSessionResult>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/positions", async (
                int sessionKey,
                int driverNumber,
                DateTimeOffset fromUtc,
                DateTimeOffset toUtc,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                if (driverNumber is < 1 or > 99) return Invalid("driverNumber", "Driver number must be between 1 and 99.");
                if (toUtc <= fromUtc) return Invalid("toUtc", "End time must be later than start time.");
                if (toUtc - fromUtc > TimeSpan.FromMinutes(3))
                {
                    return Invalid("toUtc", "Position requests are limited to a three-minute window.");
                }

                try
                {
                    return Results.Ok(await provider.GetPositionsAsync(
                        sessionKey, driverNumber, fromUtc, toUtc, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session positions are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalDriverPositions")
            .WithSummary("Load a bounded position window for one driver")
            .WithDescription("Requires UTC time bounds no wider than three minutes to keep provider requests bounded.")
            .Produces<HistoricalCatalog<HistoricalPositionSample>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/race-positions", async (
                int sessionKey,
                DateTimeOffset fromUtc,
                DateTimeOffset toUtc,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                if (toUtc <= fromUtc) return Invalid("toUtc", "End time must be later than start time.");
                if (toUtc - fromUtc > TimeSpan.FromMinutes(3)) return Invalid("toUtc", "Position requests are limited to a three-minute window.");
                try
                {
                    return Results.Ok(await provider.GetSessionPositionsAsync(sessionKey, fromUtc, toUtc, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session positions are temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalRacePositions")
            .WithSummary("Load all driver positions for a bounded race replay window")
            .WithDescription("Returns recorded OpenF1 X/Y locations for all drivers in a maximum three-minute UTC window.")
            .Produces<HistoricalCatalog<HistoricalPositionSample>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/classification", async (
                int sessionKey,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                try
                {
                    return Results.Ok(await provider.GetClassificationAsync(sessionKey, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Session classification is temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalClassification")
            .WithSummary("List timestamped running order changes")
            .WithDescription("Returns OpenF1 classification changes with timestamps for replay synchronization.")
            .Produces<HistoricalCatalog<HistoricalClassificationChange>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        group.MapGet("/sessions/{sessionKey:int}/car-data", async (
                int sessionKey,
                int driverNumber,
                DateTimeOffset fromUtc,
                DateTimeOffset toUtc,
                IHistoricalSessionProvider provider,
                CancellationToken cancellationToken) =>
            {
                if (sessionKey <= 0) return Invalid("sessionKey", "Session key must be greater than zero.");
                if (driverNumber is < 1 or > 99) return Invalid("driverNumber", "Driver number must be between 1 and 99.");
                if (toUtc <= fromUtc) return Invalid("toUtc", "End time must be later than start time.");
                if (toUtc - fromUtc > TimeSpan.FromMinutes(3)) return Invalid("toUtc", "Telemetry requests are limited to a three-minute window.");
                try
                {
                    return Results.Ok(await provider.GetCarDataAsync(sessionKey, driverNumber, fromUtc, toUtc, cancellationToken));
                }
                catch (HistoricalProviderException exception)
                {
                    return ProviderUnavailable("Car telemetry is temporarily unavailable", exception);
                }
            })
            .WithName("GetHistoricalCarData")
            .WithSummary("Load selected driver telemetry for a bounded replay window")
            .WithDescription("Returns sampled speed, throttle, brake, RPM, gear and DRS values. Coverage depends on session and driver.")
            .Produces<HistoricalCatalog<HistoricalCarSample>>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        return endpoints;
    }

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    private static IResult ProviderUnavailable(string title, HistoricalProviderException exception) =>
        Results.Problem(
            title: title,
            statusCode: StatusCodes.Status503ServiceUnavailable,
            detail: exception.Message);
}
