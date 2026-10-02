import { Decimal } from "@bsd/domain";

/**
 * Evaluates typed arithmetic such as `20+30` or `(5*24)+3` with Decimal. Anything else (cell
 * references, functions) returns null: workbook formulas are never executed (PLAN §8).
 */
export function evaluateArithmetic(text: string): Decimal | null {
  const source = text.replace(/^=/, "").replace(/\s+/g, "");
  if (!/^[\d+\-*/.()]+$/.test(source)) return null;
  let pos = 0;

  const peek = (): string | undefined => source[pos];
  const expression = (): Decimal => {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const op = source[pos++];
      const right = term();
      value = op === "+" ? value.add(right) : value.sub(right);
    }
    return value;
  };
  const term = (): Decimal => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const op = source[pos++];
      const right = factor();
      if (op === "/" && right.isZero()) throw new RangeError("division by zero");
      value = op === "*" ? value.mul(right) : value.div(right);
    }
    return value;
  };
  const factor = (): Decimal => {
    if (peek() === "-") {
      pos++;
      return factor().neg();
    }
    if (peek() === "+") {
      pos++;
      return factor();
    }
    if (peek() === "(") {
      pos++;
      const value = expression();
      if (source[pos++] !== ")") throw new RangeError("unbalanced parentheses");
      return value;
    }
    const match = /^\d+(?:\.\d+)?|^\.\d+/.exec(source.slice(pos));
    if (!match) throw new RangeError(`unexpected token at ${pos}`);
    pos += match[0].length;
    return new Decimal(match[0]);
  };

  try {
    const value = expression();
    return pos === source.length ? value : null;
  } catch {
    return null;
  }
}
