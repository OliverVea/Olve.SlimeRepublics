#include <cstdio>
#include <cstring>
#include <string>
#include <print>

#include <libusockets.h>
#include <uwebsockets/App.h>

#include "common_generated.h"
#include "world.h"

namespace {
    // Every interface, so the frontend can be opened from another device on the LAN/tailnet.
    // The port-only listen() overload already does this, but silently — stated here so the
    // bind address is a visible decision rather than a default nobody checked.
    constexpr const char *kHost = "0.0.0.0";
    constexpr int kPort = 9001;
    constexpr int kTickHz = 20;
    constexpr int kTickIntervalMs = 1000 / kTickHz;
    constexpr float kTickDt = 1.0f / static_cast<float>(kTickHz);

    constexpr int kMaxPayloadLength = 16 * 1024;
    constexpr int kIdleTimeoutSeconds = 60;

    struct PerSocketData {
        slime::SlimeId slime_id = 0;
    };

    using WebSocket = uWS::WebSocket<false, true, PerSocketData>;

    struct Server {
        slime::World world;
        uWS::App *app = nullptr;
        slime::SlimeId next_slime_id = 1;
        flatbuffers::FlatBufferBuilder builder;
    };

    template <typename ... Ts>
    std::string EncodeServerMessage(flatbuffers::FlatBufferBuilder &builder, flatbuffers::Offset<Ts>... offsets) {
        static_assert(sizeof...(Ts) > 0);
        static_assert(((SlimeRepublics::ServerEventTraits<Ts>::enum_value != SlimeRepublics::ServerEvent::NONE) && ...), "every offset must be a ServerEvent union member");

        const std::vector<SlimeRepublics::ServerEvent> types { SlimeRepublics::ServerEventTraits<Ts>::enum_value... };
        const std::vector<flatbuffers::Offset<void>> events { offsets.Union()... };

        const auto to = builder.CreateVector(types);
        const auto eo = builder.CreateVector(events);

        auto mo = SlimeRepublics::CreateServerMessage(builder, to, eo);

        builder.Finish(mo, SlimeRepublics::ServerMessageIdentifier());

        return {
            std::string(reinterpret_cast<const char *>(builder.GetBufferPointer()),
                        builder.GetSize())
        };
    }

    std::string EncodeWorldState(flatbuffers::FlatBufferBuilder &builder, const slime::World &world) {
        builder.Clear();

        std::vector<flatbuffers::Offset<SlimeRepublics::Slime> > v;

        for (auto &&[id, pos]: world.GetSlimesWithPositions()) {
            const SlimeRepublics::Vec2 vec(pos.x, pos.y);
            v.push_back(SlimeRepublics::CreateSlime(builder, id, &vec));
        }

        const auto svo = builder.CreateVector(v);
        const auto wso = SlimeRepublics::CreateWorldState(builder, svo);

        return EncodeServerMessage(builder, wso);
    }

    std::string EncodePongEvent(flatbuffers::FlatBufferBuilder &builder, const SlimeRepublics::PingEvent& pingEvent) {
        builder.Clear();

        const auto peo = SlimeRepublics::CreatePongEvent(builder, pingEvent.origin_time());

        return EncodeServerMessage(builder, peo);
    }

    void OnTick(us_timer_t *timer) {
        Server *server = nullptr;
        std::memcpy(&server, us_timer_ext(timer), sizeof(Server *));

        server->world.Tick(kTickDt);
        server->app->publish("world", EncodeWorldState(server->builder, server->world), uWS::OpCode::BINARY);
    }

    void OnMessage(flatbuffers::FlatBufferBuilder &builder, slime::World& world, WebSocket* ws, std::string_view message) {
        auto *buf = reinterpret_cast<const uint8_t *>(message.data());

        flatbuffers::Verifier verifier(buf, message.size());
        if (!verifier.VerifyBuffer<SlimeRepublics::ClientInput>(nullptr)) {
            return;
        }

        const auto *input = flatbuffers::GetRoot<SlimeRepublics::ClientInput>(buf);

        const auto *events = input->events();
        const auto *event_types = input->events_type();

        for (auto [raw_event, event_type] : std::views::zip(*events, *event_types)) {
            switch (event_type) {
                case SlimeRepublics::ClientEvent::MoveEvent: {
                    const auto moveEvent = static_cast<const SlimeRepublics::MoveEvent*>(raw_event);
                    world.MoveSlime(ws->getUserData()->slime_id, moveEvent->direction());
                    break;
                }
                case SlimeRepublics::ClientEvent::PingEvent: {
                    const auto pingEvent = static_cast<const SlimeRepublics::PingEvent*>(raw_event);
                    ws->send(EncodePongEvent(builder, *pingEvent));
                    break;

                }
                default: {
                    std::println("Got unsupported event type: {}", (long)event_type);
                    break;
                }
            }

        }
    }
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    Server server;
    uWS::App app;
    server.app = &app;

    app.addServerName("0.0.0.0");

    app.ws<PerSocketData>(
                "/*",
                {
                    .compression = uWS::SHARED_COMPRESSOR,
                    .maxPayloadLength = kMaxPayloadLength,
                    .idleTimeout = kIdleTimeoutSeconds,
                    .open =
                    [&server](WebSocket *ws) {
                        const slime::SlimeId id = server.next_slime_id++;
                        ws->getUserData()->slime_id = id;
                        ws->subscribe("world");
                        server.world.Enqueue(slime::Spawn{id});
                    },
                    .message =
                    [&server](WebSocket *ws, std::string_view message,
                              uWS::OpCode) {
                        OnMessage(server.builder, server.world, ws, message);
                    },
                    .close =
                    [&server](WebSocket *ws, int, std::string_view) {
                        server.world.Enqueue(
                            slime::Despawn{ws->getUserData()->slime_id});
                    },
                })
            .listen(kHost, kPort, [](const auto *token) {
                if (token) {
                    std::printf("listening on ws://%s:%d\n", kHost, kPort);
                } else {
                    std::printf("failed to listen on %s:%d\n", kHost, kPort);
                }
            });

    Server *server_ptr = &server;
    us_timer_t *tick = us_create_timer(
        reinterpret_cast<us_loop_t *>(uWS::Loop::get()), 0, sizeof(Server *));
    std::memcpy(us_timer_ext(tick), &server_ptr, sizeof(Server *));
    us_timer_set(tick, OnTick, kTickIntervalMs, kTickIntervalMs);

    std::printf("ticking at %d Hz\n", kTickHz);
    app.run();

    return 0;
}
