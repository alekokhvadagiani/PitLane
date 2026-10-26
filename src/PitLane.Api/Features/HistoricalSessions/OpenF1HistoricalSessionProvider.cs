using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace PitLane.Api.Features.HistoricalSessions;

public sealed class OpenF1HistoricalSessionProvider(
    HttpClient httpClient,
    IMemoryCache cache,
    TimeProvider timeProvider) : IHistoricalSessionProvider
{
    private const string Source = "OpenF1";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

    public Task<HistoricalCatalog<HistoricalMeeting>> GetMeetingsAsync(
        int year,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:meetings:{year}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Meeting>($"meetings?year={year}", cancellationToken);
            var meetings = records
                .Where(item => item.MeetingKey > 0 && item.Year == year &&
                    !string.IsNullOrWhiteSpace(item.MeetingName))
                .OrderBy(item => item.DateStart)
                .Select(item => new HistoricalMeeting(
                    item.MeetingKey,
                    item.MeetingName,
                    item.Location,
                    item.CountryName,
                    item.CircuitShortName,
                    item.Year,
                    item.DateStart,
                    item.DateEnd,
                    item.IsCancelled))
                .ToArray();

            return new HistoricalCatalog<HistoricalMeeting>(Source, timeProvider.GetUtcNow(), meetings);
        })!;

    public Task<HistoricalCatalog<HistoricalSession>> GetSessionsAsync(
        int meetingKey,
        CancellationToken cancellationToken) =>
        cache.GetOrCreateAsync($"openf1:sessions:{meetingKey}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            var records = await FetchAsync<OpenF1Session>($"sessions?meeting_key={meetingKey}", cancellationToken);
            var sessions = records
                .Where(item => item.SessionKey > 0 && item.MeetingKey == meetingKey &&
                    !string.IsNullOrWhiteSpace(item.SessionName))
                .OrderBy(item => item.DateStart)
                .Select(item => new HistoricalSession(
                    item.SessionKey,
                    item.MeetingKey,
                    item.SessionName,
                    item.SessionType,
                    item.DateStart,
                    item.DateEnd))
                .ToArray();

            return new HistoricalCatalog<HistoricalSession>(Source, timeProvider.GetUtcNow(), sessions);
        })!;

    private async Task<IReadOnlyList<T>> FetchAsync<T>(string path, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.GetAsync(path, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new HistoricalProviderException("OpenF1 could not provide historical session metadata. Try again shortly.");
            }

            return await response.Content.ReadFromJsonAsync<List<T>>(cancellationToken: cancellationToken) ?? [];
        }
        catch (HistoricalProviderException)
        {
            throw;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HistoricalProviderException("OpenF1 took too long to return historical session metadata. Try again.");
        }
        catch (HttpRequestException)
        {
            throw new HistoricalProviderException("OpenF1 is unavailable. Check your connection and try again.");
        }
        catch (JsonException)
        {
            throw new HistoricalProviderException("OpenF1 returned session metadata in an unexpected format.");
        }
    }

    private sealed record OpenF1Meeting(
        [property: JsonPropertyName("meeting_key")] int MeetingKey,
        [property: JsonPropertyName("meeting_name")] string MeetingName,
        [property: JsonPropertyName("location")] string Location,
        [property: JsonPropertyName("country_name")] string CountryName,
        [property: JsonPropertyName("circuit_short_name")] string CircuitShortName,
        [property: JsonPropertyName("year")] int Year,
        [property: JsonPropertyName("date_start")] DateTimeOffset DateStart,
        [property: JsonPropertyName("date_end")] DateTimeOffset DateEnd,
        [property: JsonPropertyName("is_cancelled")] bool IsCancelled);

    private sealed record OpenF1Session(
        [property: JsonPropertyName("session_key")] int SessionKey,
        [property: JsonPropertyName("meeting_key")] int MeetingKey,
        [property: JsonPropertyName("session_name")] string SessionName,
        [property: JsonPropertyName("session_type")] string SessionType,
        [property: JsonPropertyName("date_start")] DateTimeOffset DateStart,
        [property: JsonPropertyName("date_end")] DateTimeOffset? DateEnd);
}
