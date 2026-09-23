// Pins the Direction mapping across the wire boundary.
//
// The domain enum (game/primitives.h) and the generated wire enum
// (schema/common.fbs) are two separate types that happen to share ordinals, and
// Codec::ToWire/FromWire rely on that. Nothing in the compiler enforces it: insert a
// member into either enum and every value after it shifts, the casts keep compiling, and
// the only symptom is that movement silently does the wrong thing. These tests are what
// notices.

#include <catch2/catch_test_macros.hpp>

#include "generated/common_generated.h"
#include "game/primitives.h"
#include "transport/codec.h"

namespace {
    constexpr Direction kDomain[] = {
        Direction::None, Direction::Up, Direction::Down, Direction::Left, Direction::Right,
    };

    constexpr SlimeRepublics::Direction kWire[] = {
        SlimeRepublics::Direction::None, SlimeRepublics::Direction::Up,
        SlimeRepublics::Direction::Down, SlimeRepublics::Direction::Left,
        SlimeRepublics::Direction::Right,
    };
}

TEST_CASE("every domain direction survives a round trip", "[direction]") {
    const Codec codec;
    for (const Direction d : kDomain) {
        INFO("direction = " << to_string(d));
        const auto decoded = codec.FromWire(codec.ToWire(d));
        REQUIRE(decoded.has_value());
        REQUIRE(*decoded == d);
    }
}

TEST_CASE("every wire direction survives a round trip", "[direction]") {
    const Codec codec;
    for (const SlimeRepublics::Direction w : kWire) {
        INFO("wire = " << SlimeRepublics::EnumNameDirection(w));
        const auto decoded = codec.FromWire(w);
        REQUIRE(decoded.has_value());
        REQUIRE(codec.ToWire(*decoded) == w);
    }
}

// The round trips above pass even if both enums are shifted by the same amount, so they
// cannot catch a member inserted into one and mirrored into the other by accident. This
// names each pair, which is the check that actually fails when the schema is reordered.
TEST_CASE("domain and wire directions name the same values", "[direction]") {
    const Codec codec;
    CHECK(codec.ToWire(Direction::None)  == SlimeRepublics::Direction::None);
    CHECK(codec.ToWire(Direction::Up)    == SlimeRepublics::Direction::Up);
    CHECK(codec.ToWire(Direction::Down)  == SlimeRepublics::Direction::Down);
    CHECK(codec.ToWire(Direction::Left)  == SlimeRepublics::Direction::Left);
    CHECK(codec.ToWire(Direction::Right) == SlimeRepublics::Direction::Right);
}

// A client controls this byte and the FlatBuffers verifier does not range-check enum
// fields, so MoveEvent::direction() can hand the codec any int8_t at all. Rejecting is the
// contract, not coercing to None: the transport drops the event, and the simulation never
// sees a Move it cannot explain.
TEST_CASE("a wire direction outside the enum is rejected", "[direction]") {
    const Codec codec;
    for (const int raw : {-1, 5, 99, 127}) {
        INFO("raw = " << raw);
        REQUIRE_FALSE(codec.FromWire(static_cast<SlimeRepublics::Direction>(raw)).has_value());
    }
}

// Vec2i has no operator== yet, so these compare componentwise. Once it gains
// `bool operator==(const Vec2i&) const = default;` this helper goes away and the checks
// below become plain `a == b`.
namespace {
    bool Same(const Vec2i a, const Vec2i b) { return a.x == b.x && a.y == b.y; }
}

TEST_CASE("directions move a pose by one tile", "[direction]") {
    CHECK(Same(to_vector(Direction::None), Vec2i::Zero));
    CHECK(Same(to_vector(Direction::Up),   Vec2i::Up));
    CHECK(Same(to_vector(Direction::Left), Vec2i::Left));
    CHECK(Same(to_vector(Direction::Up) + to_vector(Direction::Down), Vec2i::Zero));
}
