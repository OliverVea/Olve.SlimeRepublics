using System.Buffers.Binary;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// The binary wire format for the realtime socket. Every frame is
/// <c>WebSocketMessageType.Binary</c> and starts with a single opcode byte; the rest is a
/// fixed-layout, little-endian payload written with <see cref="BinaryPrimitives"/>.
/// <para>
/// This deliberately bypasses <see cref="AppJsonContext"/>. A 40-slime snapshot is 487 bytes here
/// against roughly 2 KB of JSON, and encoding is a few <c>Span</c> writes with no allocation — the
/// difference matters when it happens <see cref="RealtimeOptions.TickHz"/> times a second per
/// connection. JSON stays on the HTTP side, where payloads are rare and debuggability wins.
/// </para>
/// <para>
/// Opcodes below <see cref="ControlRangeEnd"/> are the control channel (session lifecycle: hello,
/// re-auth, heartbeat) and are rare. <c>0x10+</c> is server-to-client state and <c>0x20+</c> is
/// client-to-server intent — the hot path. Keeping the ranges apart means a new state message never
/// has to fight the control channel for an opcode.
/// </para>
/// </summary>
public static class RealtimeProtocol
{
    /// <summary>Highest opcode reserved for the control channel.</summary>
    public const byte ControlRangeEnd = 0x0F;

    // --- Control channel (0x00–0x0F) ---

    /// <summary>Server to client, once per connection: which entity you are and when your auth lapses.</summary>
    public const byte ServerHello = 0x01;

    /// <summary>Client to server: a fresh ticket, extending this connection's auth deadline in place.</summary>
    public const byte ReAuth = 0x02;

    /// <summary>Server to client: the re-auth landed, here is the new deadline.</summary>
    public const byte ReAuthAck = 0x03;

    /// <summary>Server to client: echo the timestamp back so both ends learn the peer is alive.</summary>
    public const byte Ping = 0x04;

    /// <summary>Client to server: the echoed <see cref="Ping"/> timestamp.</summary>
    public const byte Pong = 0x05;

    // --- State, server to client (0x10+) ---

    /// <summary>The authoritative world state for one tick.</summary>
    public const byte WorldSnapshot = 0x10;

    // --- Intent, client to server (0x20+) ---

    /// <summary>A desired movement direction. Carries no entity id — see <see cref="RealtimeConnection"/>.</summary>
    public const byte MoveIntent = 0x20;

    // --- Frame sizes ---

    /// <summary>opcode + entityId + tickHz + authExpiresAt.</summary>
    public const int ServerHelloSize = 1 + 4 + 1 + 8;

    /// <summary>opcode + authExpiresAt.</summary>
    public const int ReAuthAckSize = 1 + 8;

    /// <summary>opcode + timestamp, for both <see cref="Ping"/> and <see cref="Pong"/>.</summary>
    public const int HeartbeatSize = 1 + 8;

    /// <summary>opcode + dirX + dirY.</summary>
    public const int MoveIntentSize = 1 + 4 + 4;

    /// <summary>opcode + tick + slimeCount.</summary>
    public const int SnapshotHeaderSize = 1 + 4 + 2;

    /// <summary>entityId + x + y.</summary>
    public const int SnapshotEntrySize = 4 + 4 + 4;

    /// <summary>The largest snapshot <paramref name="maxSlimes"/> can produce, for buffer sizing.</summary>
    public static int MaxSnapshotSize(int maxSlimes) =>
        SnapshotHeaderSize + (maxSlimes * SnapshotEntrySize);

    /// <summary>
    /// Writes a <see cref="WorldSnapshot"/> frame and returns its length. The caller owns
    /// <paramref name="destination"/> and must size it with <see cref="MaxSnapshotSize"/>.
    /// </summary>
    public static int WriteSnapshot(Span<byte> destination, uint tick, ReadOnlySpan<SlimeState> slimes)
    {
        destination[0] = WorldSnapshot;
        BinaryPrimitives.WriteUInt32LittleEndian(destination[1..], tick);
        BinaryPrimitives.WriteUInt16LittleEndian(destination[5..], (ushort)slimes.Length);

        var offset = SnapshotHeaderSize;
        foreach (var slime in slimes)
        {
            BinaryPrimitives.WriteUInt32LittleEndian(destination[offset..], slime.Id);
            BinaryPrimitives.WriteSingleLittleEndian(destination[(offset + 4)..], slime.X);
            BinaryPrimitives.WriteSingleLittleEndian(destination[(offset + 8)..], slime.Y);
            offset += SnapshotEntrySize;
        }

        return offset;
    }

    /// <summary>Builds the one-shot <see cref="ServerHello"/> sent immediately after the upgrade.</summary>
    public static byte[] BuildServerHello(uint entityId, int tickHz, DateTimeOffset authExpiresAt)
    {
        var frame = new byte[ServerHelloSize];
        frame[0] = ServerHello;
        BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(1), entityId);
        frame[5] = (byte)tickHz;
        BinaryPrimitives.WriteInt64LittleEndian(frame.AsSpan(6), authExpiresAt.ToUnixTimeSeconds());
        return frame;
    }

    /// <summary>Builds the <see cref="ReAuthAck"/> confirming a connection's extended auth deadline.</summary>
    public static byte[] BuildReAuthAck(DateTimeOffset authExpiresAt)
    {
        var frame = new byte[ReAuthAckSize];
        frame[0] = ReAuthAck;
        BinaryPrimitives.WriteInt64LittleEndian(frame.AsSpan(1), authExpiresAt.ToUnixTimeSeconds());
        return frame;
    }

    /// <summary>Builds a <see cref="Ping"/> carrying <paramref name="timestampMs"/> for the client to echo.</summary>
    public static byte[] BuildPing(long timestampMs)
    {
        var frame = new byte[HeartbeatSize];
        frame[0] = Ping;
        BinaryPrimitives.WriteInt64LittleEndian(frame.AsSpan(1), timestampMs);
        return frame;
    }

    /// <summary>Reads a <see cref="MoveIntent"/> payload, rejecting frames of the wrong length.</summary>
    public static bool TryReadMoveIntent(ReadOnlySpan<byte> frame, out float x, out float y)
    {
        if (frame.Length != MoveIntentSize)
        {
            x = y = 0;
            return false;
        }

        x = BinaryPrimitives.ReadSingleLittleEndian(frame[1..]);
        y = BinaryPrimitives.ReadSingleLittleEndian(frame[5..]);
        return true;
    }
}

/// <summary>
/// Application-defined WebSocket close codes (the 4000–4999 range is reserved for exactly this).
/// Each one tells the client whether reconnecting is worth attempting.
/// </summary>
public static class RealtimeCloseCodes
{
    /// <summary>Auth deadline passed without a <see cref="RealtimeProtocol.ReAuth"/>. Refresh over HTTP, then reconnect.</summary>
    public const int AuthExpired = 4001;

    /// <summary>Malformed or unexpected frame. A bug — do not reconnect in a loop.</summary>
    public const int ProtocolError = 4002;

    /// <summary>The client fell too far behind the tick stream. Reconnect after a backoff.</summary>
    public const int TooSlow = 4003;

    /// <summary>No frame received within the heartbeat timeout. Reconnect.</summary>
    public const int HeartbeatTimeout = 4004;

    /// <summary>The server is at <see cref="RealtimeOptions.MaxConnections"/>. Reconnect after a backoff.</summary>
    public const int ServerFull = 4005;
}
