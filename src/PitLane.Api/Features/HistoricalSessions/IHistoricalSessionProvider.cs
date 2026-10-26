namespace PitLane.Api.Features.HistoricalSessions;

public interface IHistoricalSessionProvider
{
    Task<HistoricalCatalog<HistoricalMeeting>> GetMeetingsAsync(int year, CancellationToken cancellationToken);
    Task<HistoricalCatalog<HistoricalSession>> GetSessionsAsync(int meetingKey, CancellationToken cancellationToken);
}
