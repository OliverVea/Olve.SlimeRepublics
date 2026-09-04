// Olve.SlimeRepublics game server.
//
// Build (no build system by design):
//   g++ -O3 main.cpp -luSockets -lz -luv -o server
//
// Headers and libuSockets.a live in /usr/local; see README.md for how they got
// there and how to reinstall them on a fresh machine.

#include <cstdio>
#include <string>

#include <uWebSockets/App.h>

#include "generated/common_generated.h"

namespace {

// Per-connection state. One slime per socket, for now.
struct PerSocketData {
  uint32_t slime_id = 0;
};

// Serialises the current world as a FlatBuffer. Placeholder contents until the
// real simulation exists.
std::string EncodeWorldState() {
  flatbuffers::FlatBufferBuilder builder;

  const SlimeRepublics::Vec2 position(1.0f, 2.0f);
  auto slime = SlimeRepublics::CreateSlime(builder, 7, &position);
  auto slimes = builder.CreateVector({slime});

  auto strike = SlimeRepublics::CreateStrikeEvent(builder, 7, 9, 3, true);
  auto event = SlimeRepublics::CreateNetworkEvent(
      builder, SlimeRepublics::EventData::StrikeEvent, strike.Union());
  auto events = builder.CreateVector({event});

  builder.Finish(SlimeRepublics::CreateWorldState(builder, slimes, events));

  return {reinterpret_cast<const char *>(builder.GetBufferPointer()),
          builder.GetSize()};
}

}  // namespace

int main() {
  constexpr int kPort = 9001;
  uint32_t next_slime_id = 1;

  uWS::App()
      .ws<PerSocketData>(
          "/*",
          {
              .compression = uWS::SHARED_COMPRESSOR,
              .maxPayloadLength = 16 * 1024,
              .idleTimeout = 60,
              .open =
                  [&next_slime_id](uWS::WebSocket<false, true, PerSocketData> *ws) {
                    ws->getUserData()->slime_id = next_slime_id++;
                    ws->subscribe("world");
                    ws->send(EncodeWorldState(), uWS::OpCode::BINARY);
                  },
              .message =
                  [](uWS::WebSocket<false, true, PerSocketData> *ws,
                     std::string_view message, uWS::OpCode opcode) {
                    // Echo for now; the real protocol lands with the simulation.
                    ws->send(message, opcode);
                  },
              .close =
                  [](uWS::WebSocket<false, true, PerSocketData> *ws, int,
                     std::string_view) {
                    std::printf("slime %u disconnected\n",
                                ws->getUserData()->slime_id);
                  },
          })
      .listen(kPort,
              [](auto *token) {
                if (token) {
                  std::printf("listening on ws://localhost:%d\n", kPort);
                } else {
                  std::printf("failed to listen on port %d\n", kPort);
                }
              })
      .run();

  return 0;
}
