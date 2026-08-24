using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// One live socket: the identity bound to it, its outbound queue, and the two loops that drive it.
/// <para>
/// <b>Why the queue exists.</b> <see cref="WebSocket.SendAsync"/> permits exactly one send in flight
/// per socket; a second concurrent call corrupts the stream. The tick loop therefore never touches a
/// socket. It enqueues, and a single pump task per connection is the only thing that ever sends.
/// The queue is bounded with <see cref="BoundedChannelFullMode.DropOldest"/> so a client whose TCP
/// window has closed can never apply backpressure to the simulation — it just falls behind, and
/// falling behind far enough (<see cref="RealtimeOptions.MaxDroppedFrames"/>) gets it disconnected
/// rather than served stale state forever. Dropping the <i>oldest</i> is right because snapshots are
/// absolute, not incremental: the newest one always supersedes whatever it displaced.
/// </para>
/// <para>
/// <b>The security invariant.</b> <see cref="EntityId"/> and <see cref="Subject"/> are assigned at
/// handshake and are not settable from the wire. No inbound frame carries an actor id — a client
/// says "move in this direction", never "move entity 7" — so there is no such thing as a frame that
/// acts on someone else's slime. This is what replaces per-message signing: authority comes from
/// which socket the bytes arrived on, and that is not something a client can forge.
/// </para>
/// </summary>
public sealed class RealtimeConnection
{
    private readonly WebSocket _socket;
    private readonly RealtimeOptions _options;
    private readonly SlimeWorld _world;
    private readonly RealtimeTicketStore _tickets;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger _logger;
    private readonly Channel<ReadOnlyMemory<byte>> _outbound;

    private int _droppedFrames;
    private long _authExpiresAtTicks;
    private long _lastClientFrameTicks;
    private int _closeStatus;

    internal RealtimeConnection(
        WebSocket socket,
        uint entityId,
        RealtimeIdentity identity,
        SlimeWorld world,
        RealtimeTicketStore tickets,
        IOptions<RealtimeOptions> options,
        TimeProvider timeProvider,
        ILogger logger)
    {
        _socket = socket;
        _world = world;
        _tickets = tickets;
        _options = options.Value;
        _timeProvider = timeProvider;
        _logger = logger;

        EntityId = entityId;
        Subject = identity.Subject;
        Name = identity.Name;

        _authExpiresAtTicks = identity.SessionExpiresAt.UtcTicks;
        _lastClientFrameTicks = timeProvider.GetUtcNow().UtcTicks;

        _outbound = Channel.CreateBounded<ReadOnlyMemory<byte>>(
            new BoundedChannelOptions(_options.SendQueueCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            },
            itemDropped: _ => Interlocked.Increment(ref _droppedFrames));
    }

    /// <summary>The slime this connection controls. Assigned by the server, never by the client.</summary>
    public uint EntityId { get; }

    /// <summary>The authenticated subject behind this connection.</summary>
    public string Subject { get; }

    /// <summary>The display name from the token, when it carried one.</summary>
    public string? Name { get; }

    /// <summary>When this connection's authorisation lapses absent a <see cref="RealtimeProtocol.ReAuth"/>.</summary>
    public DateTimeOffset AuthExpiresAt =>
        new(Volatile.Read(ref _authExpiresAtTicks), TimeSpan.Zero);

    /// <summary>Frames discarded because this client could not keep up.</summary>
    public int DroppedFrames => Volatile.Read(ref _droppedFrames);

    /// <summary>
    /// Queues a frame for delivery. Safe to call from any thread and never blocks — this is what the
    /// tick loop calls, once per connection, and it must stay O(1) and non-failing.
    /// </summary>
    public void Enqueue(ReadOnlyMemory<byte> frame) => _outbound.Writer.TryWrite(frame);

    /// <summary>
    /// Runs the connection until either loop finishes, then closes the socket from a single place.
    /// Send and receive run concurrently but touch disjoint halves of the socket, which is the only
    /// concurrency the WebSocket API actually allows.
    /// </summary>
    internal async Task RunAsync(CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        Enqueue(RealtimeProtocol.BuildServerHello(EntityId, _options.TickHz, AuthExpiresAt));

        var send = SendLoopAsync(cts.Token);
        var receive = ReceiveLoopAsync(cts.Token);

        await Task.WhenAny(send, receive);
        await cts.CancelAsync();

        // Both loops must be finished before the close handshake: closing while a send is in flight
        // is the same concurrent-use violation the pump exists to prevent.
        try
        {
            await Task.WhenAll(send, receive);
        }
        catch (Exception exception) when (exception is OperationCanceledException or WebSocketException)
        {
            // Expected on teardown — the surviving loop is being cancelled or the peer vanished.
        }

        await CloseAsync();
    }

    private async Task SendLoopAsync(CancellationToken cancellationToken)
    {
        var heartbeat = TimeSpan.FromSeconds(_options.HeartbeatSeconds);
        var clientTimeout = TimeSpan.FromSeconds(_options.ClientTimeoutSeconds);
        var nextPing = _timeProvider.GetUtcNow() + heartbeat;

        try
        {
            await foreach (var frame in _outbound.Reader.ReadAllAsync(cancellationToken))
            {
                var now = _timeProvider.GetUtcNow();

                // The pump wakes on every tick anyway, so it is the natural place to enforce the
                // deadlines rather than paying for a separate timer per connection.
                if (now >= AuthExpiresAt)
                {
                    Fail(RealtimeCloseCodes.AuthExpired);
                    return;
                }

                if (now - new DateTimeOffset(Volatile.Read(ref _lastClientFrameTicks), TimeSpan.Zero) > clientTimeout)
                {
                    Fail(RealtimeCloseCodes.HeartbeatTimeout);
                    return;
                }

                if (DroppedFrames > _options.MaxDroppedFrames)
                {
                    Fail(RealtimeCloseCodes.TooSlow);
                    return;
                }

                await _socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken);

                if (now >= nextPing)
                {
                    nextPing = now + heartbeat;
                    await _socket.SendAsync(
                        RealtimeProtocol.BuildPing(now.ToUnixTimeMilliseconds()),
                        WebSocketMessageType.Binary,
                        endOfMessage: true,
                        cancellationToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown or the receive loop ended first.
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
    {
        // One buffer for the connection's lifetime. Every defined client frame is a handful of
        // bytes, so this never grows and never needs pooling.
        var buffer = new byte[_options.MaxInboundFrameBytes];

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var received = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                if (received.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }

                // A frame larger than the buffer arrives as !EndOfMessage. Nothing legitimate is
                // that big, so treat it as a protocol error instead of reassembling attacker input.
                if (!received.EndOfMessage || received.Count == 0)
                {
                    Fail(RealtimeCloseCodes.ProtocolError);
                    return;
                }

                Volatile.Write(ref _lastClientFrameTicks, _timeProvider.GetUtcNow().UtcTicks);

                if (!Handle(buffer.AsSpan(0, received.Count)))
                {
                    Fail(RealtimeCloseCodes.ProtocolError);
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown or the send loop ended first.
        }
        catch (WebSocketException exception)
        {
            _logger.LogDebug(exception, "Realtime connection {EntityId} dropped: {Reason}", EntityId, exception.Message);
        }
    }

    private bool Handle(ReadOnlySpan<byte> frame)
    {
        switch (frame[0])
        {
            case RealtimeProtocol.MoveIntent:
                if (!RealtimeProtocol.TryReadMoveIntent(frame, out var x, out var y))
                {
                    return false;
                }

                _world.SetIntent(EntityId, x, y);
                return true;

            case RealtimeProtocol.ReAuth:
                return HandleReAuth(frame);

            case RealtimeProtocol.Pong:
                // The timestamp is echoed back for the client's own RTT estimate; the server only
                // needed the frame's arrival, which _lastClientFrameTicks already recorded.
                return frame.Length == RealtimeProtocol.HeartbeatSize;

            default:
                return false;
        }
    }

    private bool HandleReAuth(ReadOnlySpan<byte> frame)
    {
        var ticket = Encoding.UTF8.GetString(frame[1..]);
        if (!_tickets.TryRedeem(ticket, out var identity))
        {
            _logger.LogDebug("Realtime re-auth rejected for {EntityId}: ticket invalid or expired", EntityId);
            return true;
        }

        // A ticket for a different subject must not be able to take over a live connection — that
        // would let anyone with a valid account inherit whatever session state this socket owns.
        if (!string.Equals(identity.Subject, Subject, StringComparison.Ordinal))
        {
            _logger.LogWarning("Realtime re-auth for {EntityId} rejected: subject mismatch", EntityId);
            return false;
        }

        Volatile.Write(ref _authExpiresAtTicks, identity.SessionExpiresAt.UtcTicks);
        Enqueue(RealtimeProtocol.BuildReAuthAck(identity.SessionExpiresAt));
        return true;
    }

    private void Fail(int closeStatus)
    {
        Interlocked.CompareExchange(ref _closeStatus, closeStatus, 0);
        _outbound.Writer.TryComplete();
    }

    private async Task CloseAsync()
    {
        if (_socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived))
        {
            return;
        }

        var status = Volatile.Read(ref _closeStatus);
        try
        {
            await _socket.CloseAsync(
                status == 0 ? WebSocketCloseStatus.NormalClosure : (WebSocketCloseStatus)status,
                status == 0 ? "bye" : $"realtime:{status}",
                CancellationToken.None);
        }
        catch (WebSocketException)
        {
            // The peer is already gone; there is nobody left to tell.
        }
    }
}
