using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json;

namespace PitLane.Api.Features.Archive;

/// <summary>
/// Disk store for finished sessions: one folder per session key holding
/// gzip-compressed JSON files. Writes are atomic (temp file, then rename), so a
/// crash never leaves a half-written file that later reads as valid data.
/// </summary>
public sealed class SessionArchive
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly ConcurrentDictionary<string, Lazy<Task>> inflight = new();
    private readonly ILogger<SessionArchive> logger;

    public SessionArchive(IConfiguration configuration, IHostEnvironment environment, ILogger<SessionArchive> logger)
    {
        this.logger = logger;
        var configured = configuration["Archive:Path"];
        if (string.IsNullOrWhiteSpace(configured)) configured = "data/archive";
        Root = Path.GetFullPath(Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(environment.ContentRootPath, configured));
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }

    public bool Exists(int sessionKey, string name) => File.Exists(FilePath(sessionKey, name));

    public async Task<T?> ReadAsync<T>(int sessionKey, string name, CancellationToken cancellationToken)
        where T : class
    {
        var path = FilePath(sessionKey, name);
        if (!File.Exists(path)) return null;
        try
        {
            await using var file = File.OpenRead(path);
            await using var gzip = new GZipStream(file, CompressionMode.Decompress);
            return await JsonSerializer.DeserializeAsync<T>(gzip, Json, cancellationToken);
        }
        catch (Exception exception) when (exception is JsonException or IOException or InvalidDataException)
        {
            // A damaged file is treated as missing and fetched again.
            logger.LogWarning(exception, "Ignoring unreadable archive file {Path}", path);
            return null;
        }
    }

    public async Task WriteAsync<T>(int sessionKey, string name, T value, CancellationToken cancellationToken)
    {
        var path = FilePath(sessionKey, name);
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using (var file = File.Create(temporary))
            await using (var gzip = new GZipStream(file, CompressionLevel.Optimal))
            {
                await JsonSerializer.SerializeAsync(gzip, value, Json, cancellationToken);
            }

            File.Move(temporary, path, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The archive is a speed-up: a failed write must not fail the request.
            logger.LogWarning(exception, "Could not write archive file {Path}", path);
            TryDelete(temporary);
        }
        catch (OperationCanceledException)
        {
            TryDelete(temporary);
            throw;
        }
    }

    public long SessionBytes(int sessionKey)
    {
        var folder = SessionFolder(sessionKey);
        return Directory.Exists(folder)
            ? new DirectoryInfo(folder).EnumerateFiles("*.json.gz", SearchOption.AllDirectories).Sum(file => file.Length)
            : 0;
    }

    public IEnumerable<int> SavedSessionKeys() =>
        Directory.EnumerateDirectories(Root)
            .Select(Path.GetFileName)
            .Select(name => int.TryParse(name, NumberStyles.None, CultureInfo.InvariantCulture, out var key) ? key : 0)
            .Where(key => key > 0);

    /// <summary>
    /// Runs one fetch per key at a time: concurrent callers share the same task.
    /// The shared work ignores a single caller's cancellation so the result can
    /// still be saved for everyone else.
    /// </summary>
    public async Task<T> ShareAsync<T>(string key, Func<Task<T>> work, CancellationToken cancellationToken)
    {
        var lazy = inflight.GetOrAdd(key, _ => new Lazy<Task>(() => Run()));
        return await ((Task<T>)lazy.Value).WaitAsync(cancellationToken);

        async Task<T> Run()
        {
            try
            {
                await Task.Yield();
                return await work();
            }
            finally
            {
                inflight.TryRemove(key, out _);
            }
        }
    }

    private string SessionFolder(int sessionKey) =>
        Path.Combine(Root, sessionKey.ToString(CultureInfo.InvariantCulture));

    // Names are fixed dataset names or "dataset/chunk-start-ms", never user input.
    private string FilePath(int sessionKey, string name) =>
        Path.Combine(SessionFolder(sessionKey), name.Replace('/', Path.DirectorySeparatorChar) + ".json.gz");

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
    }
}
