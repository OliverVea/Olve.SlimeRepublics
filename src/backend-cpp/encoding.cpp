//
// Created by oliver on 9/6/26.
//

#include "encoding.h"

template <typename ... Ts>
std::string Codec::EncodeServerMessage(flatbuffers::Offset<Ts>... offsets){
    static_assert(sizeof...(Ts) > 0);
    static_assert(((SlimeRepublics::ServerEventTraits<Ts>::enum_value != SlimeRepublics::ServerEvent::NONE) && ...), "every offset must be a ServerEvent union member");

    const std::vector<SlimeRepublics::ServerEvent> types { SlimeRepublics::ServerEventTraits<Ts>::enum_value... };
    const std::vector<flatbuffers::Offset<void>> events { offsets.Union()... };

    const auto to = _builder.CreateVector(types);
    const auto eo = _builder.CreateVector(events);

    auto mo = SlimeRepublics::CreateServerMessage(_builder, to, eo);

    _builder.Finish(mo, SlimeRepublics::ServerMessageIdentifier());

    return {
        std::string(reinterpret_cast<const char *>(_builder.GetBufferPointer()),
                    _builder.GetSize())
    };
}

std::string Codec::Encode(const slime::World &world) {
    _builder.Clear();

    std::vector<flatbuffers::Offset<SlimeRepublics::Slime> > v;

    for (auto &&[id, pos]: world.GetSlimesWithPositions()) {
        const SlimeRepublics::Vec2 vec(pos.x, pos.y);
        v.push_back(SlimeRepublics::CreateSlime(_builder, id, &vec));
    }

    const auto svo = _builder.CreateVector(v);
    const auto wso = SlimeRepublics::CreateWorldState(_builder, svo);

    return EncodeServerMessage(_builder, wso);
}

std::string Codec::Encode(const SlimeRepublics::PingEvent& pingEvent) {
    _builder.Clear();

    const auto peo = SlimeRepublics::CreatePongEvent(_builder, pingEvent.origin_time());

    return EncodeServerMessage(_builder, peo);
}

