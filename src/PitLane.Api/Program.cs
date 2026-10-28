using Microsoft.OpenApi;
using PitLane.Api.Features.Archive;
using PitLane.Api.Features.Capabilities;
using PitLane.Api.Features.HistoricalSessions;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<ICapabilityCatalog, FoundationCapabilityCatalog>();
builder.Services.AddHealthChecks();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<OpenF1RequestGate>();
builder.Services.AddHttpClient<OpenF1HistoricalSessionProvider>(client =>
{
    client.BaseAddress = new Uri("https://api.openf1.org/v1/");
    client.Timeout = TimeSpan.FromSeconds(12);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("PitLane/0.1");
});
// Finished sessions are served from the disk archive; OpenF1 fills the gaps.
builder.Services.AddSingleton<SessionArchive>();
builder.Services.AddTransient<ArchivedHistoricalSessionProvider>();
builder.Services.AddTransient<IHistoricalSessionProvider>(services =>
    services.GetRequiredService<ArchivedHistoricalSessionProvider>());
builder.Services.AddSingleton<SessionDownloader>();
builder.Services.AddHostedService(services => services.GetRequiredService<SessionDownloader>());
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "PitLane API",
        Version = "v1",
        Description = "Personal Formula 1 workspace API. Historical catalogs and bounded replay windows for recorded positions, classification, and car telemetry are available from OpenF1 where session coverage exists."
    });
});

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("v1/swagger.json", "PitLane API v1");
        options.DocumentTitle = "PitLane API — Swagger";
    });
}

app.MapHealthChecks("/api/health");
app.MapHistoricalSessions();
app.MapArchive();
app.MapGet("/api/capabilities", (ICapabilityCatalog catalog) => TypedResults.Ok(catalog.GetCapabilities()))
    .WithName("GetCapabilities")
    .WithTags("Workspace")
    .WithSummary("Get application capabilities")
    .WithDescription("Reports implementation readiness for each mode, not upstream data availability or live session status.");
app.Run();
