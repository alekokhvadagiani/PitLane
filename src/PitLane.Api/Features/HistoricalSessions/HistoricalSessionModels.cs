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

public sealed record HistoricalWeatherObservation(
    DateTimeOffset Date,
    double? AirTemperature,
    double? TrackTemperature,
    double? Humidity,
    double? Pressure,
    int? Rainfall,
    double? WindSpeed,
    int? WindDirection);

public sealed record HistoricalDriver(
    int DriverNumber,
    string FullName,
    string NameAcronym,
    string TeamName,
    string TeamColour);

public sealed record HistoricalLap(
    int LapNumber,
    DateTimeOffset? DateStart,
    double? LapDuration,
    double? Sector1Duration,
    double? Sector2Duration,
    double? Sector3Duration,
    bool? IsPitOutLap);

public sealed record HistoricalPositionSample(
    DateTimeOffset Date,
    double? X,
    double? Y,
    double? Z,
    int DriverNumber = 0);

public sealed record HistoricalClassificationChange(
    DateTimeOffset Date,
    int DriverNumber,
    int Position);

public sealed record HistoricalCarSample(
    DateTimeOffset Date,
    int DriverNumber,
    int? Speed,
    int? Throttle,
    int? Brake,
    int? Rpm,
    int? Gear,
    int? Drs);

public sealed class HistoricalProviderException(string message) : Exception(message);
