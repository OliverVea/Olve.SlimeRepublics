using System.Buffers.Binary;
using Microsoft.Extensions.Options;
using Olve.SlimeRepublics.Realtime;

namespace Olve.SlimeRepublics.UnitTests.Realtime;

/// <summary>
/// The world is deliberately small, but the rules exercised here are the ones a client must not be
/// able to bend: it cannot move faster than the server allows, cannot leave the arena, and cannot
/// wedge the simulation with malformed input.
/// </summary>
public class SlimeWorldTests
{
    private const float ArenaHalfSize = 10f;
    private const float MoveSpeed = 5f;
    private const float Delta = 0.05f;

    private static SlimeWorld Create() => new(Options.Create(new RealtimeOptions
    {
        ArenaHalfSize = ArenaHalfSize,
        MoveSpeed = MoveSpeed,
        MaxConnections = 64,
    }));

    private static byte[] Buffer() => new byte[RealtimeProtocol.MaxSnapshotSize(64)];

    private static (float X, float Y) ReadPosition(ReadOnlySpan<byte> snapshot, uint entityId)
    {
        var count = BinaryPrimitives.ReadUInt16LittleEndian(snapshot[5..]);
        for (var i = 0; i < count; i++)
        {
            var offset = RealtimeProtocol.SnapshotHeaderSize + (i * RealtimeProtocol.SnapshotEntrySize);
            if (BinaryPrimitives.ReadUInt32LittleEndian(snapshot[offset..]) == entityId)
            {
                return (BinaryPrimitives.ReadSingleLittleEndian(snapshot[(offset + 4)..]),
                        BinaryPrimitives.ReadSingleLittleEndian(snapshot[(offset + 8)..]));
            }
        }

        return (float.NaN, float.NaN);
    }

    private static int SlimeCount(ReadOnlySpan<byte> snapshot) =>
        BinaryPrimitives.ReadUInt16LittleEndian(snapshot[5..]);

    [Test]
    public async Task Join_AppearsInTheNextSnapshot()
    {
        var world = Create();
        var buffer = Buffer();

        var entityId = world.Join();
        var length = world.Tick(Delta, buffer);

        await Assert.That(SlimeCount(buffer.AsSpan(0, length))).IsEqualTo(1);
        await Assert.That(ReadPosition(buffer, entityId).X).IsNotEqualTo(float.NaN);
    }

    [Test]
    public async Task Leave_RemovesTheSlime()
    {
        var world = Create();
        var buffer = Buffer();
        var entityId = world.Join();
        world.Tick(Delta, buffer);

        world.Leave(entityId);
        var length = world.Tick(Delta, buffer);

        await Assert.That(SlimeCount(buffer.AsSpan(0, length))).IsEqualTo(0);
    }

    [Test]
    public async Task Tick_IncrementsTheTickCounter()
    {
        var world = Create();
        var buffer = Buffer();

        world.Tick(Delta, buffer);
        world.Tick(Delta, buffer);

        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(1))).IsEqualTo(2u);
        await Assert.That(world.CurrentTick).IsEqualTo(2u);
    }

    [Test]
    public async Task SetIntent_MovesBySpeedTimesDelta()
    {
        var world = Create();
        var buffer = Buffer();
        var entityId = world.Join();
        world.Tick(Delta, buffer);
        var before = ReadPosition(buffer, entityId);

        world.SetIntent(entityId, 1f, 0f);
        world.Tick(Delta, buffer);
        var after = ReadPosition(buffer, entityId);

        await Assert.That(after.X - before.X).IsEqualTo(MoveSpeed * Delta).Within(0.001f);
        await Assert.That(after.Y).IsEqualTo(before.Y).Within(0.001f);
    }

    [Test]
    public async Task SetIntent_WithOversizedVector_DoesNotMoveFaster()
    {
        // The speed-hack guard: the client picks a direction, the server picks the magnitude.
        var world = Create();
        var buffer = Buffer();
        var entityId = world.Join();
        world.Tick(Delta, buffer);
        var before = ReadPosition(buffer, entityId);

        world.SetIntent(entityId, 1000f, 0f);
        world.Tick(Delta, buffer);
        var after = ReadPosition(buffer, entityId);

        await Assert.That(after.X - before.X).IsEqualTo(MoveSpeed * Delta).Within(0.001f);
    }

    [Test]
    [Arguments(float.NaN, 0f)]
    [Arguments(0f, float.NaN)]
    [Arguments(float.PositiveInfinity, 0f)]
    [Arguments(0f, float.NegativeInfinity)]
    public async Task SetIntent_WithNonFiniteValues_IsIgnored(float x, float y)
    {
        // NaN propagates through the clamp and would poison the position permanently.
        var world = Create();
        var buffer = Buffer();
        var entityId = world.Join();
        world.Tick(Delta, buffer);
        var before = ReadPosition(buffer, entityId);

        world.SetIntent(entityId, x, y);
        world.Tick(Delta, buffer);
        var after = ReadPosition(buffer, entityId);

        await Assert.That(after.X).IsEqualTo(before.X).Within(0.001f);
        await Assert.That(after.Y).IsEqualTo(before.Y).Within(0.001f);
    }

    [Test]
    public async Task Tick_ClampsSlimesToTheArena()
    {
        var world = Create();
        var buffer = Buffer();
        var entityId = world.Join();
        world.SetIntent(entityId, 1f, 1f);

        // Far more ticks than it takes to cross the arena from any spawn point.
        for (var i = 0; i < 500; i++)
        {
            world.Tick(Delta, buffer);
        }

        var position = ReadPosition(buffer, entityId);
        await Assert.That(position.X).IsEqualTo(ArenaHalfSize).Within(0.001f);
        await Assert.That(position.Y).IsEqualTo(ArenaHalfSize).Within(0.001f);
    }

    [Test]
    public async Task SetIntent_ForAnUnknownEntity_IsHarmless()
    {
        var world = Create();
        var buffer = Buffer();

        world.SetIntent(9999u, 1f, 0f);
        var length = world.Tick(Delta, buffer);

        await Assert.That(SlimeCount(buffer.AsSpan(0, length))).IsEqualTo(0);
    }

    [Test]
    public async Task Join_GivesEveryConnectionADistinctEntityId()
    {
        var world = Create();

        var ids = Enumerable.Range(0, 50).Select(_ => world.Join()).ToList();

        await Assert.That(ids.Distinct().Count()).IsEqualTo(50);
    }
}
