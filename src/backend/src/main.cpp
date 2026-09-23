#include <cstdio>
#include <cstring>
#include <string>

#include <libusockets.h>
#include <sodium/core.h>
#include <uwebsockets/App.h>
#include <spdlog/spdlog.h>
#include <spdlog/fmt/bin_to_hex.h>

#include "generated/common_generated.h"
#include "game/world.h"
#include "transport/codec.h"
#include "transport/formatting.h"
#include "users/manager.h"

namespace {
    constexpr const char *kHost = "0.0.0.0";
    constexpr int kPort = 9001;
    constexpr int kTickHz = 20;
    constexpr int kTickIntervalMs = 1000 / kTickHz;
    constexpr float kTickDt = 1.0f / static_cast<float>(kTickHz);

    constexpr int kMaxPayloadLength = 16 * 1024;
    constexpr int kIdleTimeoutSeconds = 60;

    struct PerSocketData {
        SlimeId slime_id;
    };

    using WebSocket = uWS::WebSocket<false, true, PerSocketData>;

    SlimeId GetNextSlimeId(SlimeId &next_slime_id) {
        SlimeId result = next_slime_id;
        next_slime_id = SlimeId((long)next_slime_id + 1);
        return result;
    }

    void OnMessage(const Codec &codec, EventQueue& event_queue, WebSocket* ws, std::string_view message) {
        auto *buf = reinterpret_cast<const uint8_t *>(message.data());
        const SlimeId slime_id = ws->getUserData()->slime_id;

        if (flatbuffers::Verifier verifier(buf, message.size()); !verifier.VerifyBuffer<SlimeRepublics::ClientInput>(nullptr)) {
            spdlog::error("{} Got invalid message with size {} bytes: {:spn}", slime_id, message.size(), spdlog::to_hex(message));
            return;
        }

        const auto *input = flatbuffers::GetRoot<SlimeRepublics::ClientInput>(buf);

        const auto *events = input->events();
        const auto *event_types = input->events_type();

        for (auto [raw_event, event_type] : std::views::zip(*events, *event_types)) {
            switch (event_type) {
                case SlimeRepublics::ClientEvent::MoveEvent: {
                    const auto moveEvent = static_cast<const SlimeRepublics::MoveEvent*>(raw_event);
                    const auto rawDirection = moveEvent->direction();
                    const auto direction = codec.FromWire(rawDirection);
                    if (!direction) {
                        spdlog::warn("{} Got direction: {} ({})", slime_id, rawDirection, (long)rawDirection);
                        break;
                    }
                    event_queue.emplace(Move(slime_id, *direction));
                    break;
                }
                case SlimeRepublics::ClientEvent::InteractEvent: {
                    //const auto interactEvent = static_cast<const SlimeRepublics::InteractEvent*>(raw_event);
                    event_queue.emplace(Interact(slime_id));
                    break;
                }
                case SlimeRepublics::ClientEvent::PingEvent: {
                    const auto pingEvent = static_cast<const SlimeRepublics::PingEvent*>(raw_event);
                    ws->send(codec.Encode(*pingEvent));
                    break;

                }
                default: {
                    spdlog::error("{} Got unsupported event type: {} ({})", slime_id, event_type, (long)event_type);
                    break;
                }
            }

        }
    }
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    entt::registry registry;
    EntitySystem entity_system(registry);
    EventQueue event_queue;
    GameManager game_manager(entity_system, event_queue);
    Codec codec;
    uWS::App app;

    UserRepository user_repository;
    UserManager user_manager(user_repository);

    user_manager.Initialize();

    user_manager.CreateUser("user@example.com", "Example User", "password123", true);

    auto next_slime_id = static_cast<SlimeId>(1);

    app.addServerName("0.0.0.0");

    app.ws<PerSocketData>(
                "/*",
                {
                    .compression = uWS::SHARED_COMPRESSOR,
                    .maxPayloadLength = kMaxPayloadLength,
                    .idleTimeout = kIdleTimeoutSeconds,
                    .upgrade = [&next_slime_id](uWS::HttpResponse<false> *response, uWS::HttpRequest *request, us_socket_context_t* ctx) {
                        auto secWebSocketProtocol = request->getHeader("sec-websocket-protocol");
                        auto secWebSocketExtensions = request->getHeader("sec-websocket-extensions");
                        auto secWebSocketKey = request->getHeader("sec-websocket-key");

                        auto requestAddress = request->getHeader("x-real-ip");
                        const SlimeId slime_id = GetNextSlimeId(next_slime_id);

                        spdlog::info("Client connecting {}, {}",  requestAddress, slime_id);

                        response->upgrade<PerSocketData>({ slime_id }, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, ctx);
                    },
                    .open =
                    [&event_queue](WebSocket *ws) {
                        auto slime_id = ws->getUserData()->slime_id;
                        spdlog::info("Client connected {}", slime_id);
                        ws->subscribe("world");
                        event_queue.emplace(Spawn{slime_id});
                    },
                    .message =
                    [&event_queue, &codec](WebSocket *ws, std::string_view message,
                              uWS::OpCode) {
                        OnMessage(codec,event_queue, ws, message);
                    },
                    .close =
                    [&event_queue](WebSocket *ws, int, std::string_view) {
                        const SlimeId slime_id = ws->getUserData()->slime_id;
                        event_queue.emplace(Despawn(slime_id));
                        spdlog::info("Client disconnected {}, {}", ws->getRemoteAddressAsText(), slime_id);
                    },
                })
            .listen(kHost, kPort, [](const auto *token) {
                if (token) {
                    spdlog::info("listening on ws://{}:{}", kHost, kPort);
                } else {
                    spdlog::critical("failed to listen on {}:{}", kHost, kPort);
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

    spdlog::info("ticking at {} Hz", kTickHz);
    app.run();

    return 0;
}
