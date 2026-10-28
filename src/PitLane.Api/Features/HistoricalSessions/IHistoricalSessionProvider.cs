namespace PitLane.Api.Features.HistoricalSessions;

public interface IHistoricalSessionProvider
{
    Task<HistoricalCatalog<HistoricalMeeting>> GetMeetingsAsync(int year, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalSession>> GetSessionsAsync(int meetingKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalWeatherObservation>> GetWeatherAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalDriver>> GetDriversAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalLap>> GetLapsAsync(int sessionKey, int driverNumber, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalLap>> GetSessionLapsAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalStint>> GetStintsAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalPitStop>> GetPitStopsAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalRaceControlMessage>> GetRaceControlAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalTeamRadio>> GetTeamRadioAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalSessionResult>> GetSessionResultsAsync(int sessionKey, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalPositionSample>> GetPositionsAsync(
        int sessionKey,
        int driverNumber,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalPositionSample>> GetSessionPositionsAsync(
        int sessionKey,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalClassificationChange>> GetClassificationAsync(
        int sessionKey,
        CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalInterval>> GetIntervalsAsync(
        int sessionKey,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalCarSample>> GetCarDataAsync(
        int sessionKey,
        int driverNumber,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken);
}
