//
// Created by oliver on 9/7/26.
//

#ifndef BACKEND_CPP_EVENTS_H
#define BACKEND_CPP_EVENTS_H

#include <queue>
#include "primitives.h"

struct Spawn {
    SlimeId id;
};

struct Despawn {
    SlimeId id;
};

struct Move {
    SlimeId id;
    Direction direction;
};

struct Interact {
    SlimeId id;
};

using Event = std::variant<Spawn, Despawn, Move, Interact>;
using EventQueue = std::queue<Event>;

#endif //BACKEND_CPP_EVENTS_H
