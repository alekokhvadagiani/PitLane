using Microsoft.OpenApi;
using PitLane.Api.Features.Capabilities;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<ICapabilityCatalog, FoundationCapabilityCatalog>();
builder.Services.AddHealthChecks();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "PitLane API",
        Version = "v1",
        Description = "Personal Formula 1 workspace API. Race data integrations are not implemented yet."
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
app.MapGet("/api/capabilities", (ICapabilityCatalog catalog) => TypedResults.Ok(catalog.GetCapabilities()))
    .WithName("GetCapabilities")
    .WithTags("Workspace")
    .WithSummary("Get application capabilities")
    .WithDescription("Reports implementation readiness for each mode, not upstream data availability or live session status.");
app.Run();
