using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Olve.SlimeRepublics.IntegrationTests;

/// <summary>
/// The realtime handshake and wire format, exercised against the real container over a real socket.
/// Nothing here is mocked: if the upgrade, the ticket, the tick loop or the binary layout is wrong,
/// these fail the same way a browser would.
/// </summary>
[ClassDataSource<AppFixture>(Shared = SharedType.PerAssembly)]
public class RealtimeTests(AppFixture fixture)
{
    private const byte ServerHello = 0x01;
    private const byte ReAuth = 0x02;
    private const byte ReAuthAck = 0x03;
    private const byte Ping = 0x04;
    private const byte Pong = 0x05;
    private const byte WorldSnapshot = 0x10;
    private const byte MoveIntent = 0x20;

    private const int SnapshotHeaderSize = 7;
    private const int SnapshotEntrySize = 12;

    private static readonly TimeSpan ReceiveTimeout = TimeSpan.FromSeconds(10);

    // --- Ticket endpoint ---

    [Test]
    public async Task Ticket_Unauthenticated_Returns401()
    {
        using var client = fixture.CreateUnauthenticatedHttpClient();

        var response = await client.PostAsync("/api/realtime/ticket", content: null);

        await Assert.That(response.StatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Ticket_Authenticated_ReturnsTicketAndSessionExpiry()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();

        var ticket = await IssueTicketAsync(client);

        await Assert.That(ticket.Ticket).IsNotNullOrEmpty();
        await Assert.That(ticket.ExpiresInSeconds).IsGreaterThan(0);
        await Assert.That(ticket.SessionExpiresAtUnixSeconds)
            .IsGreaterThan(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    // --- Upgrade ---

    [Test]
    public async Task Connect_WithoutTicket_IsRejected()
    {
        using var socket = new ClientWebSocket();
        socket.Options.CollectHttpResponseDetails = true;

        var act = async () => await socket.ConnectAsync(fixture.WebSocketUri(ticket: null), CancellationToken.None);

        await Assert.That(act).Throws<WebSocketException>();
        await Assert.That(socket.HttpStatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Connect_WithForgedTicket_IsRejected()
    {
        using var socket = new ClientWebSocket();
        socket.Options.CollectHttpResponseDetails = true;

        var act = async () => await socket.ConnectAsync(
            fixture.WebSocketUri("definitely-not-a-real-ticket"), CancellationToken.None);

        await Assert.That(act).Throws<WebSocketException>();
        await Assert.That(socket.HttpStatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
    }

    [Test]
    public async Task Connect_WithValidTicket_ReceivesServerHello()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);

        var hello = await ReceiveAsync(socket);

        await Assert.That(hello[0]).IsEqualTo(ServerHello);
        await Assert.That(BinaryPrimitives.ReadUInt32LittleEndian(hello.AsSpan(1))).IsGreaterThan(0u);
        await Assert.That(hello[5]).IsGreaterThan((byte)0); // tick rate
        await Assert.That(BinaryPrimitives.ReadInt64LittleEndian(hello.AsSpan(6)))
            .IsGreaterThan(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    [Test]
    public async Task Ticket_CannotBeRedeemedTwice()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        var ticket = await IssueTicketAsync(client);

        using var first = new ClientWebSocket();
        await first.ConnectAsync(fixture.WebSocketUri(ticket.Ticket), CancellationToken.None);

        using var second = new ClientWebSocket();
        second.Options.CollectHttpResponseDetails = true;
        var act = async () => await second.ConnectAsync(fixture.WebSocketUri(ticket.Ticket), CancellationToken.None);

        await Assert.That(act).Throws<WebSocketException>();
        await Assert.That(second.HttpStatusCode).IsEqualTo(HttpStatusCode.Unauthorized);
    }

    // --- Tick stream ---

    [Test]
    public async Task Connected_ReceivesWorldSnapshotsContainingItsOwnSlime()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        var entityId = BinaryPrimitives.ReadUInt32LittleEndian((await ReceiveAsync(socket)).AsSpan(1));

        var snapshot = await ReceiveUntilAsync(socket, WorldSnapshot);

        await Assert.That(TryReadPosition(snapshot, entityId, out _, out _)).IsTrue();
    }

    [Test]
    public async Task Snapshots_AdvanceTheTickCounter()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        await ReceiveAsync(socket);

        var first = BinaryPrimitives.ReadUInt32LittleEndian(
            (await ReceiveUntilAsync(socket, WorldSnapshot)).AsSpan(1));
        var second = BinaryPrimitives.ReadUInt32LittleEndian(
            (await ReceiveUntilAsync(socket, WorldSnapshot)).AsSpan(1));

        await Assert.That(second).IsGreaterThan(first);
    }

    [Test]
    public async Task MoveIntent_MovesTheSendersSlime()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        var entityId = BinaryPrimitives.ReadUInt32LittleEndian((await ReceiveAsync(socket)).AsSpan(1));

        var start = await ReceiveUntilAsync(socket, WorldSnapshot);
        TryReadPosition(start, entityId, out var startX, out _);

        // Move toward -X, which is away from the arena edge for any spawn point on the +X side and
        // toward it otherwise — either way the position must change over a handful of ticks.
        await SendMoveIntentAsync(socket, -1f, 0f);

        var movedX = startX;
        for (var i = 0; i < 20 && Math.Abs(movedX - startX) < 0.01f; i++)
        {
            var snapshot = await ReceiveUntilAsync(socket, WorldSnapshot);
            TryReadPosition(snapshot, entityId, out movedX, out _);
        }

        await Assert.That(movedX).IsLessThan(startX);
    }

    [Test]
    public async Task Ping_IsAnsweredByPongWithoutClosingTheConnection()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        await ReceiveAsync(socket);

        var ping = await ReceiveUntilAsync(socket, Ping, maxFrames: 600);
        var pong = new byte[9];
        pong[0] = Pong;
        ping.AsSpan(1, 8).CopyTo(pong.AsSpan(1));
        await socket.SendAsync(pong, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

        // The connection survives: snapshots keep arriving after the exchange.
        var snapshot = await ReceiveUntilAsync(socket, WorldSnapshot);
        await Assert.That(snapshot[0]).IsEqualTo(WorldSnapshot);
        await Assert.That(socket.State).IsEqualTo(WebSocketState.Open);
    }

    // --- Session lifecycle ---

    [Test]
    public async Task ReAuth_WithAFreshTicket_ExtendsTheSession()
    {
        using var shortLived = fixture.CreateAuthenticatedHttpClient(TimeSpan.FromMinutes(2));
        using var socket = await ConnectAsync(shortLived);
        var hello = await ReceiveAsync(socket);
        var originalDeadline = BinaryPrimitives.ReadInt64LittleEndian(hello.AsSpan(6));

        // The refresh itself is HTTP's job; the socket only carries the resulting ticket.
        using var refreshed = fixture.CreateAuthenticatedHttpClient(TimeSpan.FromMinutes(30));
        var newTicket = await IssueTicketAsync(refreshed);

        var frame = new byte[1 + Encoding.UTF8.GetByteCount(newTicket.Ticket)];
        frame[0] = ReAuth;
        Encoding.UTF8.GetBytes(newTicket.Ticket, frame.AsSpan(1));
        await socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

        var ack = await ReceiveUntilAsync(socket, ReAuthAck);

        await Assert.That(BinaryPrimitives.ReadInt64LittleEndian(ack.AsSpan(1))).IsGreaterThan(originalDeadline);
        await Assert.That(socket.State).IsEqualTo(WebSocketState.Open);
    }

    [Test]
    public async Task UnknownOpcode_ClosesWithProtocolError()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        await ReceiveAsync(socket);

        await socket.SendAsync(new byte[] { 0x7F, 0x00 }, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

        var closeStatus = await ReceiveUntilCloseAsync(socket);
        await Assert.That((int)closeStatus!).IsEqualTo(4002);
    }

    [Test]
    public async Task MalformedMoveIntent_ClosesWithProtocolError()
    {
        using var client = fixture.CreateAuthenticatedHttpClient();
        using var socket = await ConnectAsync(client);
        await ReceiveAsync(socket);

        // Right opcode, wrong length — the length check is what stops a truncated frame being read
        // as whatever happened to be next in the buffer.
        await socket.SendAsync(new byte[] { MoveIntent, 0x00, 0x00 }, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

        var closeStatus = await ReceiveUntilCloseAsync(socket);
        await Assert.That((int)closeStatus!).IsEqualTo(4002);
    }

    [Test]
    public async Task TwoClients_SeeEachOtherInTheSameSnapshot()
    {
        using var clientA = fixture.CreateAuthenticatedHttpClient();
        using var clientB = fixture.CreateAuthenticatedHttpClient();
        using var socketA = await ConnectAsync(clientA);
        var entityA = BinaryPrimitives.ReadUInt32LittleEndian((await ReceiveAsync(socketA)).AsSpan(1));
        using var socketB = await ConnectAsync(clientB);
        var entityB = BinaryPrimitives.ReadUInt32LittleEndian((await ReceiveAsync(socketB)).AsSpan(1));

        await Assert.That(entityA).IsNotEqualTo(entityB);

        var sawBoth = false;
        for (var i = 0; i < 20 && !sawBoth; i++)
        {
            var snapshot = await ReceiveUntilAsync(socketA, WorldSnapshot);
            sawBoth = TryReadPosition(snapshot, entityA, out _, out _)
                && TryReadPosition(snapshot, entityB, out _, out _);
        }

        await Assert.That(sawBoth).IsTrue();
    }

    // --- Helpers ---

    private static async Task<TicketResponse> IssueTicketAsync(HttpClient client)
    {
        var response = await client.PostAsync("/api/realtime/ticket", content: null);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TicketResponse>(JsonOptions))!;
    }

    private async Task<ClientWebSocket> ConnectAsync(HttpClient client)
    {
        var ticket = await IssueTicketAsync(client);
        var socket = new ClientWebSocket();
        await socket.ConnectAsync(fixture.WebSocketUri(ticket.Ticket), CancellationToken.None);
        return socket;
    }

    private static async Task SendMoveIntentAsync(WebSocket socket, float x, float y)
    {
        var frame = new byte[9];
        frame[0] = MoveIntent;
        BinaryPrimitives.WriteSingleLittleEndian(frame.AsSpan(1), x);
        BinaryPrimitives.WriteSingleLittleEndian(frame.AsSpan(5), y);
        await socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);
    }

    private static async Task<byte[]> ReceiveAsync(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(ReceiveTimeout);
        var buffer = new byte[4096];
        var received = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token);
        return buffer.AsSpan(0, received.Count).ToArray();
    }

    private static async Task<byte[]> ReceiveUntilAsync(WebSocket socket, byte opcode, int maxFrames = 200)
    {
        for (var i = 0; i < maxFrames; i++)
        {
            var frame = await ReceiveAsync(socket);
            if (frame.Length > 0 && frame[0] == opcode)
            {
                return frame;
            }
        }

        throw new TimeoutException($"No frame with opcode 0x{opcode:X2} within {maxFrames} frames.");
    }

    private static async Task<WebSocketCloseStatus?> ReceiveUntilCloseAsync(WebSocket socket, int maxFrames = 200)
    {
        using var timeout = new CancellationTokenSource(ReceiveTimeout);
        var buffer = new byte[4096];
        for (var i = 0; i < maxFrames; i++)
        {
            var received = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token);
            if (received.MessageType == WebSocketMessageType.Close)
            {
                return socket.CloseStatus;
            }
        }

        throw new TimeoutException($"Connection stayed open for {maxFrames} frames.");
    }

    private static bool TryReadPosition(ReadOnlySpan<byte> snapshot, uint entityId, out float x, out float y)
    {
        x = y = 0;
        var count = BinaryPrimitives.ReadUInt16LittleEndian(snapshot[5..]);
        for (var i = 0; i < count; i++)
        {
            var offset = SnapshotHeaderSize + (i * SnapshotEntrySize);
            if (BinaryPrimitives.ReadUInt32LittleEndian(snapshot[offset..]) != entityId)
            {
                continue;
            }

            x = BinaryPrimitives.ReadSingleLittleEndian(snapshot[(offset + 4)..]);
            y = BinaryPrimitives.ReadSingleLittleEndian(snapshot[(offset + 8)..]);
            return true;
        }

        return false;
    }

    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    private sealed record TicketResponse(string Ticket, int ExpiresInSeconds, long SessionExpiresAtUnixSeconds);
}
