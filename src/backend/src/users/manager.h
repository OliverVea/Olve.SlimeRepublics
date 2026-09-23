//
// Created by oliver on 9/7/26.
//

#ifndef BACKEND_CPP_USERS_MANAGER_H
#define BACKEND_CPP_USERS_MANAGER_H

#include <cstdint>
#include <optional>
#include <expected>
#include <string>
#include <unordered_map>
#include <vector>

enum class UserId : std::uint32_t {};

struct User {
    UserId id;
    std::string email;
    std::string display_name;
    std::string pw_hash;
    bool test_account = false;
    // Created time
    // Last logged in time
};



enum class UserCreationError {
    InvalidPassword,
};

struct CreateUserRequest {
    std::string email;
    std::string display_name;
    std::string password;
};

class UserRepository {
    std::vector<User> users_;

public:
    std::optional<UserId> GetUserIdByEmail(const std::string &email) { return std::nullopt; }
    std::optional<User> GetUser(UserId user_id) { return std::nullopt; }
    std::optional<std::string> GetUserSaltedPassword(UserId user_id) { return std::nullopt; }
    std::expected<UserId, UserCreationError> CreateUser(const std::string &email, const std::string &display_name, const std::string &password, bool test_account) {return std::unexpected(UserCreationError::InvalidPassword);}
};

class UserManager {
    UserRepository& repository_;

    int ops_limit_;
    int mem_limit_;

    bool initialized_ = false;
    std::string dummy_password_ = "dummy_password";
    std::string dummy_password_hash_;

public:
    UserManager(UserRepository& repository);

    void Initialize();
    std::expected<UserId, UserCreationError> CreateUser(const std::string &email, const std::string &display_name, const std::string &password, bool test_account) const;
    std::optional<User> CheckUserLogin(const std::string &email, const std::string &password) const;
};

#endif //BACKEND_CPP_USERS_MANAGER_H
