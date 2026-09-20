// Copyright 2012 Google Inc.
//
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-skia file at the root of this repository.
//
// TypeScript port: 2026 Eugene Napryaglo.
// Source: third_party/skia/src/pathops/SkPathOpsTypes.{h,cpp}
//         (Skia commit pinned in third_party/skia)
//
// Epsilon constants + comparison predicates used throughout Skia's
// pathops codebase. The single source of truth for "how close is close
// enough" — every other pathops file leans on these helpers rather
// than open-coding `< FLT_EPSILON`.
//
// TypeScript `number` is IEEE-754 double, so the `double` overloads
// from Skia map 1:1 here. The float-precision ULPS comparators round
// inputs to IEEE-754 single-precision via a Float32Array stash before
// taking integer ULP distance — same semantic as Skia's downcast to
// `SkScalar` (which is float on every Skia target we care about).

// -----------------------------------------------------------------------------
// Epsilon constants (mirror SkPathOpsTypes.h:303-321).
//
// SK_FloatEpsilon = 2^-23 ≈ 1.1920928955078125e-7 — the gap between 1.0
// and the next-larger float. Skia's pathops scales this by integer
// multipliers (1, 2, 4, 16, 64, 256, 2048, 4096) to define
// "approximate", "rough", and "way rough" tolerances for different
// stages of the boolean engine.

export const SK_FLOAT_EPSILON           = 1.1920928955078125e-7;          // FLT_EPSILON, exact.
export const SK_DOUBLE_EPSILON          = 2.2204460492503131e-16;         // DBL_EPSILON, exact.

export const FLT_EPSILON_CUBED          = SK_FLOAT_EPSILON ** 3;
export const FLT_EPSILON_HALF           = SK_FLOAT_EPSILON / 2;
export const FLT_EPSILON_DOUBLE         = SK_FLOAT_EPSILON * 2;
export const FLT_EPSILON_ORDERABLE_ERR  = SK_FLOAT_EPSILON * 16;
export const FLT_EPSILON_SQUARED        = SK_FLOAT_EPSILON ** 2;
// Skia uses the precomputed 17-digit constant for FLT_EPSILON_SQRT
// (= sqrt(FLT_EPSILON)) to keep this value at compile-time and avoid a
// global initializer. We mirror it exactly so test results align bit-
// for-bit with Skia.
export const FLT_EPSILON_SQRT           = 0.00034526697709225118;
export const FLT_EPSILON_INVERSE        = 1 / SK_FLOAT_EPSILON;
export const DBL_EPSILON_ERR            = SK_DOUBLE_EPSILON * 4;          // "FIXME: tune" per Skia.
export const DBL_EPSILON_SUBDIVIDE_ERR  = SK_DOUBLE_EPSILON * 16;
export const ROUGH_EPSILON              = SK_FLOAT_EPSILON * 64;
export const MORE_ROUGH_EPSILON         = SK_FLOAT_EPSILON * 256;
export const WAY_ROUGH_EPSILON          = SK_FLOAT_EPSILON * 2048;
export const BUMP_EPSILON               = SK_FLOAT_EPSILON * 4096;
export const INVERSE_NUMBER_RANGE       = FLT_EPSILON_ORDERABLE_ERR;

// -----------------------------------------------------------------------------
// Float-bit shim. Skia's ULPS comparators read the IEEE-754 bit pattern
// of a float as a signed int. TypeScript: round-trip through a shared
// Float32Array / Int32Array pair sharing one ArrayBuffer.

const _floatBitsBuf = new ArrayBuffer(4);
const _floatBitsF32 = new Float32Array(_floatBitsBuf);
const _floatBitsI32 = new Int32Array(_floatBitsBuf);

// Bit-cast a number to its IEEE-754 single-precision representation,
// then re-interpret those bits as a signed 32-bit integer. Equivalent
// to memcpy(&bits, &x, 4) after `float x = (float) a;` in C++.
export function floatToInt32Bits(a: number): number
{
    _floatBitsF32[0] = a;
    return _floatBitsI32[0]!;
}

// Skia's `SkFloatAs2sCompliment` (sic) — converts a float to a sortable
// signed 32-bit int such that integer comparison matches float ordering
// (modulo NaN). The trick: negative floats have a sign bit set, which
// makes their raw bit pattern compare backwards. Two's-complement-style
// flip on negatives normalises the ordering.
export function SkFloatAs2sCompliment(a: number): number
{
    const bits = floatToInt32Bits(a);
    return bits < 0 ? (0x80000000 - bits) | 0 : bits;
}

// True when both inputs sit inside the denormal range for the given
// ULP epsilon — Skia treats these as equal regardless of ULP distance.
// Mirrors arguments_denormalized in SkPathOpsTypes.cpp:18.
function arguments_denormalized(a: number, b: number, epsilon: number): boolean
{
    const denormalizedCheck = SK_FLOAT_EPSILON * epsilon / 2;
    return Math.abs(a) <= denormalizedCheck && Math.abs(b) <= denormalizedCheck;
}

// Inputs must already be float-rounded (callers downcast via Float32).
function equal_ulps_raw(a: number, b: number, epsilon: number, depsilon: number): boolean
{
    if (arguments_denormalized(a, b, depsilon)) return true;
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits < bBits + epsilon && bBits < aBits + epsilon;
}

function equal_ulps_no_normal_check_raw(a: number, b: number, epsilon: number): boolean
{
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits < bBits + epsilon && bBits < aBits + epsilon;
}

function equal_ulps_pin_raw(a: number, b: number, epsilon: number, depsilon: number): boolean
{
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (arguments_denormalized(a, b, depsilon)) return true;
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits < bBits + epsilon && bBits < aBits + epsilon;
}

function d_equal_ulps_raw(a: number, b: number, epsilon: number): boolean
{
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits < bBits + epsilon && bBits < aBits + epsilon;
}

function not_equal_ulps_raw(a: number, b: number, epsilon: number): boolean
{
    if (arguments_denormalized(a, b, epsilon)) return false;
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits >= bBits + epsilon || bBits >= aBits + epsilon;
}

function not_equal_ulps_pin_raw(a: number, b: number, epsilon: number): boolean
{
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (arguments_denormalized(a, b, epsilon)) return false;
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits >= bBits + epsilon || bBits >= aBits + epsilon;
}

function d_not_equal_ulps_raw(a: number, b: number, epsilon: number): boolean
{
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits >= bBits + epsilon || bBits >= aBits + epsilon;
}

function less_ulps_raw(a: number, b: number, epsilon: number): boolean
{
    if (arguments_denormalized(a, b, epsilon))
    {
        return a <= b - SK_FLOAT_EPSILON * epsilon;
    }
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits <= bBits - epsilon;
}

function less_or_equal_ulps_raw(a: number, b: number, epsilon: number): boolean
{
    if (arguments_denormalized(a, b, epsilon))
    {
        return a < b + SK_FLOAT_EPSILON * epsilon;
    }
    const aBits = SkFloatAs2sCompliment(a);
    const bBits = SkFloatAs2sCompliment(b);
    return aBits < bBits + epsilon;
}

// Skia's double-precision overloads route through the float ULP code
// after downcasting to float32. We do the same — single source of
// truth for the comparison policy.
function asFloat(x: number): number
{
    _floatBitsF32[0] = x;
    return _floatBitsF32[0]!;
}

// -----------------------------------------------------------------------------
// Public ULPS comparators. Each `AlmostXxxUlps` predicate corresponds
// 1:1 to a public function in SkPathOpsTypes.h:232-301. Float and
// double overloads collapse here because TS `number` covers both.

export function AlmostEqualUlps(a: number, b: number): boolean
{
    return equal_ulps_raw(asFloat(a), asFloat(b), 16, 16);
}

export function AlmostEqualUlpsNoNormalCheck(a: number, b: number): boolean
{
    return equal_ulps_no_normal_check_raw(asFloat(a), asFloat(b), 16);
}

export function AlmostEqualUlps_Pin(a: number, b: number): boolean
{
    return equal_ulps_pin_raw(asFloat(a), asFloat(b), 16, 16);
}

// AlmostDequalUlps has a special double branch: when both inputs are
// finite floats it uses the standard float ULP comparison; otherwise it
// falls back to relative error |a-b| / max(|a|, |b|) < 16 * FLT_EPSILON.
// Mirrors SkPathOpsTypes.cpp:128-136.
const SK_SCALAR_MAX = 3.4028234663852886e+38; // FLT_MAX
export function AlmostDequalUlps(a: number, b: number): boolean
{
    if (Math.abs(a) < SK_SCALAR_MAX && Math.abs(b) < SK_SCALAR_MAX)
    {
        return d_equal_ulps_raw(asFloat(a), asFloat(b), 16);
    }
    const denom = Math.max(Math.abs(a), Math.abs(b));
    // sk_ieee_double_divide tolerates 0/0 → NaN, which compares false
    // (correct: NaN inputs aren't equal).
    return (Math.abs(a - b) / denom) < SK_FLOAT_EPSILON * 16;
}

export function NotAlmostEqualUlps(a: number, b: number): boolean
{
    return not_equal_ulps_raw(asFloat(a), asFloat(b), 16);
}

export function NotAlmostEqualUlps_Pin(a: number, b: number): boolean
{
    return not_equal_ulps_pin_raw(asFloat(a), asFloat(b), 16);
}

export function NotAlmostDequalUlps(a: number, b: number): boolean
{
    return d_not_equal_ulps_raw(asFloat(a), asFloat(b), 16);
}

export function AlmostBequalUlps(a: number, b: number): boolean
{
    return equal_ulps_raw(asFloat(a), asFloat(b), 2, 2);
}

export function AlmostPequalUlps(a: number, b: number): boolean
{
    return equal_ulps_raw(asFloat(a), asFloat(b), 8, 8);
}

export function RoughlyEqualUlps(a: number, b: number): boolean
{
    return equal_ulps_raw(asFloat(a), asFloat(b), 256, 1024);
}

export function AlmostLessUlps(a: number, b: number): boolean
{
    return less_ulps_raw(asFloat(a), asFloat(b), 16);
}

export function AlmostLessOrEqualUlps(a: number, b: number): boolean
{
    return less_or_equal_ulps_raw(asFloat(a), asFloat(b), 16);
}

export function AlmostBetweenUlps(a: number, b: number, c: number): boolean
{
    const fa = asFloat(a), fb = asFloat(b), fc = asFloat(c);
    return fa <= fc
        ? less_or_equal_ulps_raw(fa, fb, 2) && less_or_equal_ulps_raw(fb, fc, 2)
        : less_or_equal_ulps_raw(fb, fa, 2) && less_or_equal_ulps_raw(fc, fb, 2);
}

// SkPathOpsTypes.cpp:190 — signed integer ULP distance, capped at
// SK_MaxS32 when signs differ (+0 / -0 still report distance 0).
const SK_MAX_S32 = 0x7FFFFFFF;
export function UlpsDistance(a: number, b: number): number
{
    const fa = asFloat(a), fb = asFloat(b);
    const ai = floatToInt32Bits(fa);
    const bi = floatToInt32Bits(fb);
    if ((ai < 0) !== (bi < 0))
    {
        return fa === fb ? 0 : SK_MAX_S32;
    }
    return Math.abs(ai - bi);
}

// -----------------------------------------------------------------------------
// "approximately_*" / "precisely_*" / "roughly_*" predicates. All
// inline in SkPathOpsTypes.h:323-551. Used for T-value comparisons
// (range 0..1) and other normalised quantities. Group order mirrors
// the source for line-by-line review.

export function zero_or_one(x: number): boolean
{
    return x === 0 || x === 1;
}

export function approximately_zero(x: number): boolean
{
    return Math.abs(x) < SK_FLOAT_EPSILON;
}

export function precisely_zero(x: number): boolean
{
    return Math.abs(x) < DBL_EPSILON_ERR;
}

export function precisely_subdivide_zero(x: number): boolean
{
    return Math.abs(x) < DBL_EPSILON_SUBDIVIDE_ERR;
}

export function approximately_zero_half(x: number): boolean
{
    return Math.abs(x) < FLT_EPSILON_HALF;
}

export function approximately_zero_double(x: number): boolean
{
    return Math.abs(x) < FLT_EPSILON_DOUBLE;
}

export function approximately_zero_orderable(x: number): boolean
{
    return Math.abs(x) < FLT_EPSILON_ORDERABLE_ERR;
}

export function approximately_zero_squared(x: number): boolean
{
    return Math.abs(x) < FLT_EPSILON_SQUARED;
}

export function approximately_zero_sqrt(x: number): boolean
{
    return Math.abs(x) < FLT_EPSILON_SQRT;
}

export function roughly_zero(x: number): boolean
{
    return Math.abs(x) < ROUGH_EPSILON;
}

export function approximately_zero_inverse(x: number): boolean
{
    return Math.abs(x) > FLT_EPSILON_INVERSE;
}

export function approximately_zero_when_compared_to(x: number, y: number): boolean
{
    return x === 0 || Math.abs(x) < Math.abs(y * SK_FLOAT_EPSILON);
}

export function precisely_zero_when_compared_to(x: number, y: number): boolean
{
    return x === 0 || Math.abs(x) < Math.abs(y * SK_DOUBLE_EPSILON);
}

export function roughly_zero_when_compared_to(x: number, y: number): boolean
{
    return x === 0 || Math.abs(x) < Math.abs(y * ROUGH_EPSILON);
}

export function approximately_equal(x: number, y: number): boolean
{
    return approximately_zero(x - y);
}

export function precisely_equal(x: number, y: number): boolean
{
    return precisely_zero(x - y);
}

export function precisely_subdivide_equal(x: number, y: number): boolean
{
    return precisely_subdivide_zero(x - y);
}

export function approximately_equal_half(x: number, y: number): boolean
{
    return approximately_zero_half(x - y);
}

export function approximately_equal_double(x: number, y: number): boolean
{
    return approximately_zero_double(x - y);
}

export function approximately_equal_orderable(x: number, y: number): boolean
{
    return approximately_zero_orderable(x - y);
}

export function approximately_equal_squared(x: number, y: number): boolean
{
    return approximately_equal(x, y);
}

export function approximately_greater(x: number, y: number): boolean
{
    return x - SK_FLOAT_EPSILON >= y;
}

export function approximately_greater_double(x: number, y: number): boolean
{
    return x - FLT_EPSILON_DOUBLE >= y;
}

export function approximately_greater_orderable(x: number, y: number): boolean
{
    return x - FLT_EPSILON_ORDERABLE_ERR >= y;
}

export function approximately_greater_or_equal(x: number, y: number): boolean
{
    return x + SK_FLOAT_EPSILON > y;
}

export function approximately_greater_or_equal_double(x: number, y: number): boolean
{
    return x + FLT_EPSILON_DOUBLE > y;
}

export function approximately_greater_or_equal_orderable(x: number, y: number): boolean
{
    return x + FLT_EPSILON_ORDERABLE_ERR > y;
}

export function approximately_lesser(x: number, y: number): boolean
{
    return x + SK_FLOAT_EPSILON <= y;
}

export function approximately_lesser_double(x: number, y: number): boolean
{
    return x + FLT_EPSILON_DOUBLE <= y;
}

export function approximately_lesser_orderable(x: number, y: number): boolean
{
    return x + FLT_EPSILON_ORDERABLE_ERR <= y;
}

export function approximately_lesser_or_equal(x: number, y: number): boolean
{
    return x - SK_FLOAT_EPSILON < y;
}

export function approximately_lesser_or_equal_double(x: number, y: number): boolean
{
    return x - FLT_EPSILON_DOUBLE < y;
}

export function approximately_lesser_or_equal_orderable(x: number, y: number): boolean
{
    return x - FLT_EPSILON_ORDERABLE_ERR < y;
}

export function approximately_greater_than_one(x: number): boolean
{
    return x > 1 - SK_FLOAT_EPSILON;
}

export function precisely_greater_than_one(x: number): boolean
{
    return x > 1 - DBL_EPSILON_ERR;
}

export function approximately_less_than_zero(x: number): boolean
{
    return x < SK_FLOAT_EPSILON;
}

export function precisely_less_than_zero(x: number): boolean
{
    return x < DBL_EPSILON_ERR;
}

export function approximately_negative(x: number): boolean
{
    return x < SK_FLOAT_EPSILON;
}

export function approximately_negative_orderable(x: number): boolean
{
    return x < FLT_EPSILON_ORDERABLE_ERR;
}

export function precisely_negative(x: number): boolean
{
    return x < DBL_EPSILON_ERR;
}

export function approximately_one_or_less(x: number): boolean
{
    return x < 1 + SK_FLOAT_EPSILON;
}

export function approximately_one_or_less_double(x: number): boolean
{
    return x < 1 + FLT_EPSILON_DOUBLE;
}

export function approximately_positive(x: number): boolean
{
    return x > -SK_FLOAT_EPSILON;
}

export function approximately_positive_squared(x: number): boolean
{
    return x > -FLT_EPSILON_SQUARED;
}

export function approximately_zero_or_more(x: number): boolean
{
    return x > -SK_FLOAT_EPSILON;
}

export function approximately_zero_or_more_double(x: number): boolean
{
    return x > -FLT_EPSILON_DOUBLE;
}

export function approximately_between_orderable(a: number, b: number, c: number): boolean
{
    return a <= c
        ? approximately_negative_orderable(a - b) && approximately_negative_orderable(b - c)
        : approximately_negative_orderable(b - a) && approximately_negative_orderable(c - b);
}

export function approximately_between(a: number, b: number, c: number): boolean
{
    return a <= c
        ? approximately_negative(a - b) && approximately_negative(b - c)
        : approximately_negative(b - a) && approximately_negative(c - b);
}

export function precisely_between(a: number, b: number, c: number): boolean
{
    return a <= c
        ? precisely_negative(a - b) && precisely_negative(b - c)
        : precisely_negative(b - a) && precisely_negative(c - b);
}

// True iff (a ≤ b ≤ c) || (a ≥ b ≥ c). One multiplication, no
// branches — Skia's preferred form. SkPathOpsTypes.h:530.
export function between(a: number, b: number, c: number): boolean
{
    return (a - b) * (c - b) <= 0;
}

export function roughly_equal(x: number, y: number): boolean
{
    return Math.abs(x - y) < ROUGH_EPSILON;
}

export function roughly_negative(x: number): boolean
{
    return x < ROUGH_EPSILON;
}

export function roughly_between(a: number, b: number, c: number): boolean
{
    return a <= c
        ? roughly_negative(a - b) && roughly_negative(b - c)
        : roughly_negative(b - a) && roughly_negative(c - b);
}

export function more_roughly_equal(x: number, y: number): boolean
{
    return Math.abs(x - y) < MORE_ROUGH_EPSILON;
}

// -----------------------------------------------------------------------------
// Miscellaneous helpers (SkPathOpsTypes.h:581-606).

// Linear interpolation between A and B at parameter t.
export function Interp(A: number, B: number, t: number): number
{
    return A + (B - A) * t;
}

// Sign of x: -1, 0, or +1. Branch-free; mirrors SkPathOpsTypes.h:587.
export function Sign(x: number): number
{
    return (x > 0 ? 1 : 0) - (x < 0 ? 1 : 0);
}

// 0 if negative, 1 if zero, 2 if positive.
export function Side(x: number): number
{
    return (x > 0 ? 1 : 0) + (x >= 0 ? 1 : 0);
}

// 1 if negative, 2 if zero, 4 if positive (bitmask).
export function SideBit(x: number): number
{
    return 1 << Side(x);
}

// Clamp a T value into [0, 1] using DBL_EPSILON_ERR slack at the
// endpoints. Anything within slack of 0 snaps to 0; anything within
// slack of 1 snaps to 1; everything else passes through.
export function SkPinT(t: number): number
{
    return precisely_less_than_zero(t) ? 0 : precisely_greater_than_one(t) ? 1 : t;
}
