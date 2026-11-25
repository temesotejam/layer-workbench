// Synthetic finite-cost regression for the CI-only v2.5.0 arc-order candidate.
// This is not the OrcaSlicer graph or a full slicer test.
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <iostream>
#include <numeric>
#include <vector>

struct Endpoint {
    std::size_t contour_idx;
    double param;
};
struct Arc {
    Endpoint* intersection;
    double arc_length;
};
int main() {
    constexpr std::size_t N = 64;
    std::array<Endpoint, N> endpoints{};
    std::vector<Arc> input;
    for (std::size_t i = 0; i < N; ++i) {
        // Deliberate ties in length, contour and param, plus non-tied costs.
        endpoints[i] = {(i / 8) % 2, double((i / 2) % 4)};
        input.push_back({&endpoints[i], 1.0 + double((i / 16) % 2) * 0.25});
    }
    auto end_index = [&](const Endpoint* p) {
        return std::size_t(p - endpoints.data());
    };
    const double bucket = 0.5;
    unsigned cases = 0;
    for (const bool backwards : {false, true}) {
#include "arc-order-comparators.inc"
        for (const auto& l : input) for (const auto& r : input) {
            if (end_index(l.intersection) == end_index(r.intersection)) {
                assert(!primary(l, r) && !secondary(l, r));
            } else {
                assert(primary(l, r) != primary(r, l));
                assert(secondary(l, r) != secondary(r, l));
            }
        }
        auto verify = [&](const std::vector<Arc>& sorted, bool secondary_order) {
            // Independent expected keys: first cost/bucket, then contour,
            // then signed parameter, and finally stable graph endpoint ID.
            auto key = [&](const Arc& a) {
                return std::array<double, 4>{
                    secondary_order ? double(std::llround(a.arc_length / bucket)) : a.arc_length,
                    double(a.intersection->contour_idx),
                    secondary_order && backwards ? -a.intersection->param : a.intersection->param,
                    double(end_index(a.intersection))};
            };
            for (std::size_t i = 1; i < sorted.size(); ++i)
                assert(key(sorted[i - 1]) < key(sorted[i]));
        };
        // Exercise every cyclic permutation in both directions.
        for (std::size_t shift = 0; shift < N; ++shift) {
            for (bool reverse : {false, true}) {
                auto a = input;
                std::rotate(a.begin(), a.begin() + shift, a.end());
                if (reverse) std::reverse(a.begin(), a.end());
                auto b = a;
                std::sort(a.begin(), a.end(), primary);
                std::sort(b.begin(), b.end(), secondary);
                verify(a, false);
                verify(b, true);
                ++cases;
            }
        }
    }
    std::cout << "PASS: " << cases << " permutations/directions; strict finite-key tie ordering\n";
}
