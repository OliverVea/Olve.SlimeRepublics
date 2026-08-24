using System.Buffers.Binary;
using Olve.SlimeRepublics.Realtime;

namespace Olve.SlimeRepublics.UnitTests.Realtime;

/// <summary>
/// The wire format is a contract with every client in every language, so it is pinned by byte
/// offset rather than by round-tripping through the server's own writer — a test that only checks
/// "what I wrote is what I read" would happily accept a silent layout change.
/// </summary>
public class RealtimeProtocolTests
{
    [Test]
    public async Task WriteSnapshot_LaysOutHeaderAndEntriesLittleEndian()
    {
        var buffer = new byte[RealtimeProtocol.MaxSnapshotSize(4)];
        SlimeState[] slimes = [new(7u, 1.5f, -2.25f), new(9u, 0f, 100f)];

        var length = RealtimeProtocol.WriteSnapshot(buffer, tick: 42u, slimes);

        await Assert.That(length).IsEqualTo(RealtimeProtocol.SnapshotHeaderSize + (2 * RealtimeProtocol.SnapshotEntrySize));
        await Assert.That(buffer[0]).IsEqualTo(RealtimeProtocol.WorldSnapshot);
        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(1))).IsEqualTo(42u);
        await Assert.That(BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(5))).IsEqualTo((ushort)2);

        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(7))).IsEqualTo(7u);
        await Assert.That(BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(11))).IsEqualTo(1.5f);
        await Assert.That(BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(15))).IsEqualTo(-2.25f);

        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(19))).IsEqualTo(9u);
        await Assert.That(BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(23))).IsEqualTo(0f);
        await Assert.That(BinaryPrimitives.ReadSingleLittleEndian(buffer.AsSpan(27))).IsEqualTo(100f);
    }

    [Test]
    public async Task WriteSnapshot_WithNoSlimes_IsHeaderOnly()
    {
        var buffer = new byte[RealtimeProtocol.MaxSnapshotSize(4)];

        var length = RealtimeProtocol.WriteSnapshot(buffer, tick: 1u, []);

        await Assert.That(length).IsEqualTo(RealtimeProtocol.SnapshotHeaderSize);
        await Assert.That(BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(5))).IsEqualTo((ushort)0);
    }

    [Test]
    public async Task ServerHello_CarriesEntityTickRateAndDeadline()
    {
        var deadline = DateTimeOffset.FromUnixTimeSeconds(1_700_000_000);

        var frame = RealtimeProtocol.BuildServerHello(entityId: 3u, tickHz: 20, deadline);

        await Assert.That(frame.Length).IsEqualTo(RealtimeProtocol.ServerHelloSize);
        await Assert.That(frame[0]).IsEqualTo(RealtimeProtocol.ServerHello);
        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(frame.AsSpan(1))).IsEqualTo(3u);
        await Assert.That(frame[5]).IsEqualTo((byte)20);
        await Assert.That(BinaryPrimitives.ReadInt64LittleEndian(frame.AsSpan(6))).IsEqualTo(1_700_000_000L);
    }

    [Test]
    public async Task TryReadMoveIntent_WithCorrectLength_ReadsBothAxes()
    {
        var frame = new byte[RealtimeProtocol.MoveIntentSize];
        frame[0] = RealtimeProtocol.MoveIntent;
        BinaryPrimitives.WriteSingleLittleEndian(frame.AsSpan(1), 0.5f);
        BinaryPrimitives.WriteSingleLittleEndian(frame.AsSpan(5), -1f);

        var read = RealtimeProtocol.TryReadMoveIntent(frame, out var x, out var y);

        await Assert.That(read).IsTrue();
        await Assert.That(x).IsEqualTo(0.5f);
        await Assert.That(y).IsEqualTo(-1f);
    }

    [Test]
    [Arguments(1)]
    [Arguments(8)]
    [Arguments(10)]
    [Arguments(64)]
    public async Task TryReadMoveIntent_WithWrongLength_IsRejected(int length)
    {
        var frame = new byte[length];
        frame[0] = RealtimeProtocol.MoveIntent;

        await Assert.That(RealtimeProtocol.TryReadMoveIntent(frame, out _, out _)).IsFalse();
    }
}
