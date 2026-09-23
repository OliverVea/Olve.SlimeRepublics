//
// Created by oliver on 9/7/26.
//

#ifndef BACKEND_CPP_PRIMITIVES_H
#define BACKEND_CPP_PRIMITIVES_H
#include <cstdint>
#include <format>
#include <string>
#include <string_view>


template <class T>
struct StringFormatter : std::formatter<std::string_view> {
    auto format(const T& v, std::format_context& ctx) const {
        return std::formatter<std::string_view>::format(to_string(v), ctx);
    }
};


enum class SlimeId : std::uint32_t {};

inline std::string to_string(const SlimeId slime_id) {
    return std::format("slime({})", (long)slime_id);
}

template <> struct std::formatter<SlimeId> : StringFormatter<SlimeId> {};


// -------------
// --  Vec2i  --
// -------------

struct Vec2i {
    int x = 0, y = 0;

    constexpr Vec2i& operator+= (const Vec2i b) { x += b.x; y += b.y; return *this; }
    constexpr Vec2i operator+ (const Vec2i b) const { return { .x = x + b.x, .y = y + b.y }; }
    constexpr Vec2i operator- (const Vec2i b) const { return { .x = x - b.x, .y = y - b.y }; }

    static const Vec2i Zero, Left, Right, Up, Down;
};

constexpr Vec2i Vec2i::Zero {.x = 0, .y = 0};
constexpr Vec2i Vec2i::Up {.x = 0, .y = 1};
constexpr Vec2i Vec2i::Down {.x = 0, .y = -1};
constexpr Vec2i Vec2i::Left {.x = -1, .y = 0};
constexpr Vec2i Vec2i::Right {.x = 1, .y = 0};

inline std::string to_string(const Vec2i vec) {
    return std::format("({}, {})", vec.x, vec.y);
}

template <> struct std::formatter<Vec2i> : StringFormatter<Vec2i> {};

// -----------------
// --  Direction  --
// -----------------

enum class Direction {
    None,
    Up,
    Down,
    Left,
    Right
};

constexpr Vec2i to_vector(const Direction direction) {
    switch (direction) {
        case Direction::None: return Vec2i::Zero;
        case Direction::Up: return Vec2i::Up;
        case Direction::Down: return Vec2i::Down;
        case Direction::Left: return Vec2i::Left;
        case Direction::Right: return Vec2i::Right;
    }

    return Vec2i::Zero;
}

constexpr std::string_view to_string(const Direction direction) {
    switch (direction) {
        case Direction::None: return "None";
        case Direction::Up: return "Up";
        case Direction::Down: return "Down";
        case Direction::Left: return "Left";
        case Direction::Right: return "Right";
    }

    return "?";
}

template <> struct std::formatter<Direction> : StringFormatter<Direction> {};

// ------------
// --  Pose  --
// ------------

struct Pose {
    Vec2i position = Vec2i::Zero;
    Direction heading = Direction::Down;
};

inline std::string to_string(const Pose pose) {
    return std::format("{} ({})", pose.position, pose.heading);
}

template <> struct std::formatter<Pose> : StringFormatter<Pose> {};

#endif //BACKEND_CPP_PRIMITIVES_H
