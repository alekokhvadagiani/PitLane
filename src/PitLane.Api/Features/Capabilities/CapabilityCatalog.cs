namespace PitLane.Api.Features.Capabilities;

public sealed record ModeCapability(string Id, string Status, string Reason);
public sealed record CapabilityResponse(string Stage, IReadOnlyList<ModeCapability> Modes);

public interface ICapabilityCatalog
{
    CapabilityResponse GetCapabilities();
}

// Application readiness, not a claim about upstream provider coverage.
public sealed class FoundationCapabilityCatalog : ICapabilityCatalog
{
    public CapabilityResponse GetCapabilities() => new("foundation", [
        new("live", "notIntegrated", "Live session integration is not available yet."),
        new("replay", "catalogAvailable", "Historical meeting and session selection is available. Replay timing and position data are not loaded yet."),
        new("telemetry", "notIntegrated", "Driver telemetry integration is not available yet."),
        new("radio", "notIntegrated", "Team radio integration is not available yet.")
    ]);
}
