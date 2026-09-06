#include <cstdio>
#include <cstring>
#include <string>
#include <print>

#include <libusockets.h>
#include <uwebsockets/App.h>

#include "common_generated.h"
#include "world.h"
#include "codec.h"

namespace {
    constexpr const char *kHost = "0.0.0.0";
    constexpr int kPort = 9001;
    constexpr int kTickHz = 100;
    constexpr int kTickIntervalMs = 1000 / kTickHz;
    constexpr float kTickDt = 1.0f / static_cast<float>(kTickHz);

    constexpr int kMaxPayloadLength = 16 * 1024;
    constexpr int kIdleTimeoutSeconds = 60;

    struct PerSocketData {
        SlimeId slime_id = 0;
    };

    using WebSocket = uWS::WebSocket<false, true, PerSocketData>;

    void OnMessage(const Codec &codec, GameManager& game_manager, WebSocket* ws, std::string_view message) {
        auto *buf = reinterpret_cast<const uint8_t *>(message.data());

        if (flatbuffers::Verifier verifier(buf, message.size()); !verifier.VerifyBuffer<SlimeRepublics::ClientInput>(nullptr)) {
            return;
        }

        const auto *input = flatbuffers::GetRoot<SlimeRepublics::ClientInput>(buf);

        const auto *events = input->events();
        const auto *event_types = input->events_type();

        for (auto [raw_event, event_type] : std::views::zip(*events, *event_types)) {
            switch (event_type) {
                case SlimeRepublics::ClientEvent::MoveEvent: {
                    const auto moveEvent = static_cast<const SlimeRepublics::MoveEvent*>(raw_event);
                    game_manager.MoveSlime(ws->getUserData()->slime_id, moveEvent->direction());
                    break;
                }
                case SlimeRepublics::ClientEvent::PingEvent: {
                    const auto pingEvent = static_cast<const SlimeRepublics::PingEvent*>(raw_event);
                    ws->send(codec.Encode(*pingEvent));
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

    GameManager game_manager;
    Codec codec;
    uWS::App app;

    app.addServerName("0.0.0.0");

    app.ws<PerSocketData>(
                "/*",
                {
                    .compression = uWS::SHARED_COMPRESSOR,
                    .maxPayloadLength = kMaxPayloadLength,
                    .idleTimeout = kIdleTimeoutSeconds,
                    .open =
                    [&game_manager](WebSocket *ws) {
                        const SlimeId id = game_manager.GetNextSlimeId();
                        ws->getUserData()->slime_id = id;
                        ws->subscribe("world");
                        game_manager.Enqueue(Spawn{id});
                    },
                    .message =
                    [&game_manager, &codec](WebSocket *ws, std::string_view message,
                              uWS::OpCode) {
                        OnMessage(codec,game_manager, ws, message);
                    },
                    .close =
                    [&game_manager](WebSocket *ws, int, std::string_view) {
                        game_manager.Enqueue(Despawn{ws->getUserData()->slime_id});
                    },
                })
            .listen(kHost, kPort, [](const auto *token) {
                if (token) {
                    std::printf("listening on ws://%s:%d\n", kHost, kPort);
                } else {
                    std::printf("failed to listen on %s:%d\n", kHost, kPort);
                }
            });

    struct TickLocals {
        GameManager *game_manager = nullptr;
        Codec *codec = nullptr;
        uWS::App *app = nullptr;
    };

    const TickLocals tick_locals(&game_manager, &codec, &app);

    us_timer_t *tick = us_create_timer(reinterpret_cast<us_loop_t *>(uWS::Loop::get()), 0, sizeof(TickLocals));
    std::memcpy(us_timer_ext(tick), &tick_locals, sizeof(TickLocals));
    us_timer_set(tick, [](us_timer_t *timer) {
        TickLocals ctx;
        std::memcpy(&ctx, us_timer_ext(timer), sizeof(TickLocals));

        ctx.game_manager->Tick(kTickDt);
        ctx.app->publish("world", ctx.codec->Encode(*ctx.game_manager), uWS::OpCode::BINARY);

    }, kTickIntervalMs, kTickIntervalMs);

    std::printf("ticking at %d Hz\n", kTickHz);
    app.run();

    return 0;
}
