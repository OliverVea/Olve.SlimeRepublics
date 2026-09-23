//
// Created by oliver on 9/7/26.
//

#ifndef BACKEND_CPP_FORMATTING_H
#define BACKEND_CPP_FORMATTING_H

#include <format>
#include <string_view>
#include "generated/common_generated.h"

template <auto NameFn>
struct EnumNameFormatter : std::formatter<std::string_view> {
    template <class E>
    auto format (E value, std::format_context &ctx) const {
        return std::formatter<std::string_view>::format(NameFn(value), ctx);
    }
};

template <> struct std::formatter<SlimeRepublics::ClientEvent> : EnumNameFormatter<&SlimeRepublics::EnumNameClientEvent> {};
template <> struct std::formatter<SlimeRepublics::Direction> : EnumNameFormatter<&SlimeRepublics::EnumNameDirection> {};

#endif //BACKEND_CPP_FORMATTING_H
