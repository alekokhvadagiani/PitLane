namespace PitLane.Api.Features.HistoricalSessions;

public sealed record HistoricalCatalog<T>(
    string Source,
    DateTimeOffset RetrievedAtUtc,
    IReadOnlyList<T> Items);

public sealed record HistoricalMeeting(
    int MeetingKey,
    string MeetingName,
    string Location,
    string CountryName,
    string CircuitShortName,
    int Year,
    DateTimeOffset DateStart,
    DateTimeOffset DateEnd,
    bool IsCancelled);

public sealed record HistoricalSession(
    int SessionKey,
    int MeetingKey,
    string SessionName,
    string SessionType,
    DateTimeOffset DateStart,
    DateTimeOffset? DateEnd);

public sealed class HistoricalProviderException(string message) : Exception(message);
