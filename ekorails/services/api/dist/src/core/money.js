/**
 * Fixed-precision decimal arithmetic for money.
 *
 * Money is NEVER a JavaScript `number` in this codebase. `number` is an IEEE-754
 * double: 0.1 + 0.2 !== 0.3, and a settlement system that loses a thousandth of a
 * unit per transaction loses a real amount of real money across a real pilot.
 *
 * Representation: a BigInt of minor-est units at a fixed scale of 6 decimal places,
 * matching the database's NUMERIC(24,6) money_amount domain. Values cross the
 * database boundary as strings, never as numbers.
 *
 * Rounding: every operation that can lose precision requires the caller to state a
 * rounding mode. There is no implicit rounding anywhere.
 */
export const MONEY_SCALE = 6;
export const RATE_SCALE = 12;
const SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);
export class MoneyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MoneyError';
    }
}
/** A decimal value at a fixed scale, backed by BigInt. Immutable. */
export class Decimal {
    /** Unscaled integer value. The real value is `units / 10^scale`. */
    units;
    scale;
    constructor(units, scale) {
        this.units = units;
        this.scale = scale;
    }
    static fromString(input, scale = MONEY_SCALE) {
        const trimmed = input.trim();
        if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
            throw new MoneyError(`Not a valid fixed-point decimal: ${JSON.stringify(input)}`);
        }
        const negative = trimmed.startsWith('-');
        const magnitude = negative ? trimmed.slice(1) : trimmed;
        const dot = magnitude.indexOf('.');
        const intPart = dot === -1 ? magnitude : magnitude.slice(0, dot);
        const fracPart = dot === -1 ? '' : magnitude.slice(dot + 1);
        if (fracPart.length > scale) {
            // Silent truncation is how rounding bugs hide. Refuse instead.
            throw new MoneyError(`Value "${input}" has ${fracPart.length} decimal places but the scale is ${scale}. ` +
                `Round explicitly with Decimal.round() before constructing.`);
        }
        const padded = fracPart.padEnd(scale, '0');
        const units = BigInt(intPart + padded) * (negative ? -1n : 1n);
        return new Decimal(units, scale);
    }
    static fromUnits(units, scale = MONEY_SCALE) {
        return new Decimal(units, scale);
    }
    static zero(scale = MONEY_SCALE) {
        return new Decimal(0n, scale);
    }
    /**
     * Constructs from a JS number. Deliberately restricted to integers, because any
     * fractional double is already an approximation by the time it reaches us.
     */
    static fromInteger(value, scale = MONEY_SCALE) {
        if (!Number.isSafeInteger(value)) {
            throw new MoneyError(`Decimal.fromInteger requires a safe integer; received ${value}. ` +
                `Fractional values must arrive as strings so no precision is lost before we see them.`);
        }
        return new Decimal(BigInt(value) * 10n ** BigInt(scale), scale);
    }
    assertSameScale(other, op) {
        if (other.scale !== this.scale) {
            throw new MoneyError(`Cannot ${op} values at different scales (${this.scale} vs ${other.scale}). ` +
                `Rescale explicitly.`);
        }
    }
    add(other) {
        this.assertSameScale(other, 'add');
        return new Decimal(this.units + other.units, this.scale);
    }
    subtract(other) {
        this.assertSameScale(other, 'subtract');
        return new Decimal(this.units - other.units, this.scale);
    }
    negate() {
        return new Decimal(-this.units, this.scale);
    }
    abs() {
        return new Decimal(this.units < 0n ? -this.units : this.units, this.scale);
    }
    /**
     * Multiplies by another fixed-point value (typically an FX rate) and rounds the
     * result back to `resultScale`. The intermediate product is exact.
     */
    multiply(other, rounding, resultScale = this.scale) {
        const rawUnits = this.units * other.units; // scale = this.scale + other.scale
        const rawScale = this.scale + other.scale;
        return Decimal.rescaleUnits(rawUnits, rawScale, resultScale, rounding);
    }
    /** Multiplies by a basis-point rate (1 bp = 0.01%). */
    multiplyBasisPoints(bps, rounding) {
        const rawUnits = this.units * bps.units;
        const rawScale = this.scale + bps.scale + 4; // /10000 for bps -> fraction
        return Decimal.rescaleUnits(rawUnits, rawScale, this.scale, rounding);
    }
    divide(other, rounding, resultScale = this.scale) {
        if (other.units === 0n)
            throw new MoneyError('Division by zero');
        // Scale the numerator so the quotient lands one digit beyond the target scale,
        // leaving room to round rather than truncate.
        const shift = BigInt(resultScale + other.scale - this.scale + 1);
        const numerator = shift >= 0n ? this.units * 10n ** shift : this.units / 10n ** -shift;
        const quotient = numerator / other.units;
        return Decimal.rescaleUnits(quotient, resultScale + 1, resultScale, rounding);
    }
    static rescaleUnits(units, fromScale, toScale, rounding) {
        if (fromScale === toScale)
            return new Decimal(units, toScale);
        if (fromScale < toScale) {
            return new Decimal(units * 10n ** BigInt(toScale - fromScale), toScale);
        }
        const divisor = 10n ** BigInt(fromScale - toScale);
        const negative = units < 0n;
        const magnitude = negative ? -units : units;
        const quotient = magnitude / divisor;
        const remainder = magnitude % divisor;
        if (remainder === 0n) {
            return new Decimal(negative ? -quotient : quotient, toScale);
        }
        let rounded;
        const twiceRemainder = remainder * 2n;
        switch (rounding) {
            case 'down':
                rounded = quotient;
                break;
            case 'up':
                rounded = quotient + 1n;
                break;
            case 'half_up':
                rounded = twiceRemainder >= divisor ? quotient + 1n : quotient;
                break;
            case 'half_even':
                if (twiceRemainder > divisor)
                    rounded = quotient + 1n;
                else if (twiceRemainder < divisor)
                    rounded = quotient;
                else
                    rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
                break;
        }
        return new Decimal(negative ? -rounded : rounded, toScale);
    }
    rescale(toScale, rounding) {
        return Decimal.rescaleUnits(this.units, this.scale, toScale, rounding);
    }
    round(decimalPlaces, rounding) {
        if (decimalPlaces > this.scale)
            return this;
        return Decimal.rescaleUnits(this.units, this.scale, decimalPlaces, rounding)
            .rescale(this.scale, 'half_up');
    }
    compare(other) {
        this.assertSameScale(other, 'compare');
        if (this.units < other.units)
            return -1;
        if (this.units > other.units)
            return 1;
        return 0;
    }
    equals(other) { return this.scale === other.scale && this.units === other.units; }
    isZero() { return this.units === 0n; }
    isNegative() { return this.units < 0n; }
    isPositive() { return this.units > 0n; }
    greaterThan(other) { return this.compare(other) === 1; }
    greaterThanOrEqual(other) { return this.compare(other) >= 0; }
    lessThan(other) { return this.compare(other) === -1; }
    lessThanOrEqual(other) { return this.compare(other) <= 0; }
    /** Canonical string form. This is what goes to the database and into exports. */
    toString() {
        const negative = this.units < 0n;
        const magnitude = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0');
        const intPart = magnitude.slice(0, magnitude.length - this.scale);
        const fracPart = this.scale > 0 ? '.' + magnitude.slice(magnitude.length - this.scale) : '';
        return (negative ? '-' : '') + intPart + fracPart;
    }
    /** Human display, trimmed to the currency's minor-unit precision. */
    toDisplay(minorUnits = 2) {
        return this.rescale(minorUnits, 'half_even').toString();
    }
    toJSON() { return this.toString(); }
}
export function money(amount, currency) {
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new MoneyError(`Currency must be a 3-letter ISO code; received ${JSON.stringify(currency)}`);
    }
    return {
        amount: typeof amount === 'string' ? Decimal.fromString(amount) : amount,
        currency,
    };
}
export function addMoney(a, b) {
    assertSameCurrency(a, b, 'add');
    return { amount: a.amount.add(b.amount), currency: a.currency };
}
export function subtractMoney(a, b) {
    assertSameCurrency(a, b, 'subtract');
    return { amount: a.amount.subtract(b.amount), currency: a.currency };
}
export function assertSameCurrency(a, b, op) {
    if (a.currency !== b.currency) {
        throw new MoneyError(`Refusing to ${op} ${a.currency} and ${b.currency}. Cross-currency arithmetic must go ` +
            `through an explicit conversion with a recorded rate.`);
    }
}
/**
 * Converts an amount at a stated rate. The rate is a Decimal at RATE_SCALE and the
 * result is rounded at the destination currency's money scale. Both the rate and the
 * rounding mode are recorded by the caller alongside the result — a converted amount
 * whose rate was not persisted is not auditable.
 */
export function convert(from, toCurrency, rate, rounding = 'half_even') {
    if (!rate.isPositive())
        throw new MoneyError('An FX rate must be strictly positive');
    return { amount: from.amount.multiply(rate, rounding, MONEY_SCALE), currency: toCurrency };
}
/** Parses a NUMERIC value returned by pg (which arrives as a string). */
export function parseNumeric(value, scale = MONEY_SCALE) {
    if (value === null || value === undefined)
        return null;
    return Decimal.fromString(Number.isInteger(Number(value)) && !value.includes('.')
        ? value + '.' + '0'.repeat(scale)
        : padToScale(value, scale), scale);
}
function padToScale(value, scale) {
    const dot = value.indexOf('.');
    if (dot === -1)
        return value + '.' + '0'.repeat(scale);
    const frac = value.slice(dot + 1);
    if (frac.length > scale)
        return value.slice(0, dot + 1 + scale);
    return value + '0'.repeat(scale - frac.length);
}
export const ZERO = Decimal.zero();
//# sourceMappingURL=money.js.map