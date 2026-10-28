/** Round half away from zero to 2 decimals (centavos). */
export function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

export const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
