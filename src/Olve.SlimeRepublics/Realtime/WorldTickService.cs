using System.Diagnostics;
using Microsoft.Extensions.Options;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// The simulation heartbeat: advance the world, encode one snapshot, hand it to every connection.
/// <para>
/// A <see cref="BackgroundService"/> rather than the template's <c>IAsyncOnStartup</c>, which is for
/// one-shot startup tasks and would block the host if it never returned.
/// </para>
/// <para>
/// The snapshot is encoded <b>once</b> per tick into a reused scratch buffer, then copied into a
/// right-sized array that all connections share by reference. The copy is what makes the sharing
/// safe — the scratch buffer is overwritten next tick, while connections may still be draining the
/// previous frame. One ~3 KB allocation per tick is a Gen0 blip; eliminating it means a ring of
/// buffers with refcounted release, which is not worth the complexity until a profiler says so.
/// </para>
/// </summary>
public sealed class WorldTickService(
    SlimeWorld world,
    RealtimeHub hub,
    IOptions<RealtimeOptions> options,
    ILogger<WorldTickService> logger) : BackgroundService
{
    private readonly RealtimeOptions _options = options.Value;

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var period = TimeSpan.FromSeconds(1d / _options.TickHz);
        var deltaSeconds = (float)period.TotalSeconds;
        var scratch = new byte[RealtimeProtocol.MaxSnapshotSize(_options.MaxConnections)];

        logger.LogInformation(
            "World tick loop started at {TickHz} Hz ({PeriodMs:F1} ms/tick)",
            _options.TickHz, period.TotalMilliseconds);

        using var timer = new PeriodicTimer(period);
        var overrunWarned = false;

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var started = Stopwatch.GetTimestamp();

            var length = world.Tick(deltaSeconds, scratch);
            hub.Broadcast(scratch.AsSpan(0, length).ToArray());

            var elapsed = Stopwatch.GetElapsedTime(started);
            if (elapsed > period && !overrunWarned)
            {
                // Once, not every tick — an overrunning loop would otherwise flood the log with the
                // very work that is making it slow.
                overrunWarned = true;
                logger.LogWarning(
                    "World tick overran its {PeriodMs:F1} ms budget ({ElapsedMs:F1} ms) with {Connections} connections",
                    period.TotalMilliseconds, elapsed.TotalMilliseconds, hub.Count);
            }
        }

        logger.LogInformation("World tick loop stopped at tick {Tick}", world.CurrentTick);
    }
}
