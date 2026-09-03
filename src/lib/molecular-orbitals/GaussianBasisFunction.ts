/**
 * Gaussian Basis Function Class
 * For calculating molecular orbital wave functions
 */

export interface AngularMomentum {
  l: number;
  m: number;
  n: number;
}

export class GaussianBasisFunction {
  center: [number, number, number];
  exponents: number[];
  coefficients: number[];
  l: number;
  m: number;
  n: number;
  normalizations: number[];

  constructor(
    center: [number, number, number],
    exponents: number[],
    coefficients: number[],
    angularMomentum: AngularMomentum
  ) {
    this.center = center;
    this.exponents = exponents;
    this.coefficients = coefficients;
    this.l = angularMomentum.l || 0;
    this.m = angularMomentum.m || 0;
    this.n = angularMomentum.n || 0;

    // Precompute normalization constants
    this.normalizations = [];
    for (let i = 0; i < this.exponents.length; i++) {
      const alpha = this.exponents[i];
      const norm = this.computeNormalization(alpha, this.l, this.m, this.n);
      this.normalizations.push(norm);
    }
  }

  private computeNormalization(alpha: number, l: number, m: number, n: number): number {
    const L = l + m + n;

    // Base normalization factor
    const baseFactor = Math.pow(2 * alpha / Math.PI, 0.75);

    // Angular momentum normalization factor
    let angularFactor = 1;
    if (L > 0) {
      const df2l = this.doubleFactorial(2 * l - 1);
      const df2m = this.doubleFactorial(2 * m - 1);
      const df2n = this.doubleFactorial(2 * n - 1);

      if (df2l > 0 && df2m > 0 && df2n > 0) {
        angularFactor = Math.pow(Math.pow(4 * alpha, L) / (df2l * df2m * df2n), 0.5);
      }
    }

    const norm = baseFactor * angularFactor;

    // Check if normalization constant is reasonable
    if (!isFinite(norm) || norm <= 0) {
      console.warn(`Abnormal normalization constant: ${norm}, alpha=${alpha}, l=${l}, m=${m}, n=${n}`);
      return 1.0;
    }

    return norm;
  }

  private doubleFactorial(n: number): number {
    if (n <= 0) return 1;
    let result = 1;
    for (let i = n; i > 0; i -= 2) {
      result *= i;
    }
    return result;
  }

  evaluate(x: number, y: number, z: number): number {
    const dx = x - this.center[0];
    const dy = y - this.center[1];
    const dz = z - this.center[2];
    const r2 = dx * dx + dy * dy + dz * dz;

    let value = 0;
    for (let i = 0; i < this.exponents.length; i++) {
      const alpha = this.exponents[i];
      const coeff = this.coefficients[i];
      const norm = this.normalizations[i];

      // Prevent numerical overflow
      if (alpha * r2 > 50) {
        continue;
      }

      // Gaussian function part
      const gaussian = Math.exp(-alpha * r2);

      // Angular momentum part
      let angular = 1;
      if (this.l > 0) angular *= Math.pow(Math.abs(dx), this.l);
      if (this.m > 0) angular *= Math.pow(Math.abs(dy), this.m);
      if (this.n > 0) angular *= Math.pow(Math.abs(dz), this.n);

      // Handle odd power signs
      let sign = 1;
      if (this.l % 2 === 1 && dx < 0) sign *= -1;
      if (this.m % 2 === 1 && dy < 0) sign *= -1;
      if (this.n % 2 === 1 && dz < 0) sign *= -1;

      const contribution = coeff * norm * gaussian * angular * sign;

      // Check numerical validity
      if (isFinite(contribution)) {
        value += contribution;
      }
    }

    return value;
  }
}

export default GaussianBasisFunction;
