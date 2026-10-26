using Microsoft.OpenApi;
using PitLane.Api.Features.Capabilities;
using PitLane.Api.Features.HistoricalSessions;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<ICapabilityCatalog, FoundationCapabilityCatalog>();
builder.Services.AddHealthChecks();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IHistoricalSessionProvider, OpenF1HistoricalSessionProvider>(client =>
{
    client.BaseAddress = new Uri("https://api.openf1.org/v1/");
    client.Timeout = TimeSpan.FromSeconds(12);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("PitLane/0.1");
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "PitLane API",
        Version = "v1",
        Description = "Personal Formula 1 workspace API. Historical meeting and session metadata is available from OpenF1; replay streams are not loaded yet."
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
app.MapGet("/api/capabilities", (ICapabilityCatalog catalog) => TypedResults.Ok(catalog.GetCapabilities()))
    .WithName("GetCapabilities")
    .WithTags("Workspace")
    .WithSummary("Get application capabilities")
    .WithDescription("Reports implementation readiness for each mode, not upstream data availability or live session status.");
app.Run();
