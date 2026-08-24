namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// Tuning for the realtime layer, bound from the <c>Realtime</c> configuration section.
/// The defaults are deliberately conservative — a single-node server holding a few hundred
/// connections at 20 Hz.
/// </summary>
public sealed class RealtimeOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Realtime";

    /// <summary>
    /// Simulation and broadcast rate. 20 Hz is the usual floor for action games: high enough that
    /// client-side interpolation over a 50 ms gap looks smooth, low enough to stay cheap.
    /// </summary>
    public int TickHz { get; set; } = 20;

    /// <summary>
    /// How long a handshake ticket stays redeemable. Short by design — a ticket only has to survive
    /// the round trip from <c>POST /api/realtime/ticket</c> to the <c>WebSocket</c> constructor.
    /// </summary>
    public int TicketTtlSeconds { get; set; } = 30;

    /// <summary>
    /// Outbound frames buffered per connection before the oldest is dropped. At 20 Hz this is
    /// <c>SendQueueCapacity / TickHz</c> seconds of slack for a client whose socket has stalled.
    /// </summary>
    public int SendQueueCapacity { get; set; } = 16;

    /// <summary>
    /// Cumulative dropped frames before a connection is closed with
    /// <see cref="RealtimeCloseCodes.TooSlow"/>. A client that cannot keep up is better off
    /// reconnecting than silently watching a stale world.
    /// </summary>
    public int MaxDroppedFrames { get; set; } = 60;

    /// <summary>
    /// Seconds between server <see cref="RealtimeProtocol.Ping"/> frames. Kept well under the 60 s
    /// idle timeout that reverse proxies typically apply to upgraded connections.
    /// </summary>
    public int HeartbeatSeconds { get; set; } = 15;

    /// <summary>
    /// Seconds without any client frame before the connection is closed with
    /// <see cref="RealtimeCloseCodes.HeartbeatTimeout"/>. Must exceed
    /// <see cref="HeartbeatSeconds"/> so a single lost pong is not fatal.
    /// </summary>
    public int ClientTimeoutSeconds { get; set; } = 45;

    /// <summary>
    /// Hard connection ceiling. Also sizes the snapshot buffer, and is bounded by
    /// <see cref="ushort.MaxValue"/> because the snapshot count field is a <c>uint16</c>.
    /// </summary>
    public int MaxConnections { get; set; } = 256;

    /// <summary>Largest accepted inbound frame. Every defined client frame is under 16 bytes.</summary>
    public int MaxInboundFrameBytes { get; set; } = 256;

    /// <summary>World half-extent in world units; slimes are clamped to <c>[-Arena, +Arena]</c> on both axes.</summary>
    public float ArenaHalfSize { get; set; } = 50f;

    /// <summary>Slime movement speed in world units per second.</summary>
    public float MoveSpeed { get; set; } = 6f;
}
