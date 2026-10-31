import { decimalRatio, materialsTotalCents, type MaterialUnit } from './domain';

function nonnegative(...values: number[]): void {
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) {
    throw new Error('Podaj nieujemne liczby w bezpiecznym zakresie.');
  }
}
function result(value: number): number { nonnegative(value); return value; }

export function area(shape: 'rectangle' | 'circle' | 'triangle' | 'manual', a: number, b = 0): number {
  nonnegative(a, b);
  switch (shape) {
    case 'rectangle': return result(a * b);
    case 'circle': return result(Math.PI * a * a); // a = promień, w metrach
    case 'triangle': return result(a * b / 2); // podstawa × wysokość
    case 'manual': return a;
  }
}
export function volume(squareMetres: number, thicknessCm: number): number {
  nonnegative(squareMetres, thicknessCm);
  return result(squareMetres * (thicknessCm / 100));
}
export function dose(squareMetres: number, amount: number, per: 1 | 100): number {
  nonnegative(squareMetres, amount);
  if (per !== 1 && per !== 100) throw new Error('Wybierz dawkę na 1 lub 100 m².');
  return result(squareMetres * (amount / per));
}
export function hedge(length: number, height: number, width: number): number {
  nonnegative(length, height, width);
  return result(length * height * width);
}
const scales: Partial<Record<MaterialUnit, [string, number]>> = {
  'm³': ['volume', 1_000_000], l: ['volume', 1000], ml: ['volume', 1],
  kg: ['mass', 1000], g: ['mass', 1],
};
export function convertQuantity(quantity: number, from: MaterialUnit, to: MaterialUnit): number {
  nonnegative(quantity);
  if (from === to) return quantity;
  const source = scales[from], target = scales[to];
  if (!source || !target || source[0] !== target[0]) throw new Error('Jednostka wyniku nie pasuje do materiału. Wybierz zgodny materiał lub oblicz ilość ręcznie.');
  return result(quantity * (source[1] / target[1]));
}
export function materialCostCents(quantity: number, price: number): number {
  nonnegative(quantity, price);
  return materialsTotalCents({ materials: [{ id: 'calculation', name: 'Materiał', quantity, unitPrice: price }] });
}
export function packageCount(quantity: number, packageQuantity: number): number {
  nonnegative(quantity, packageQuantity);
  if (packageQuantity === 0) throw new Error('Ilość w opakowaniu musi być dodatnia.');
  const [amount, amountScale] = decimalRatio(quantity);
  const [size, sizeScale] = decimalRatio(packageQuantity);
  const numerator = amount * sizeScale, denominator = amountScale * size;
  return result(Number((numerator + denominator - 1n) / denominator));
}
/** Only presentation is rounded; callers retain the full numeric result. */
export function formatQuantity(value: number): string {
  // Formatting an existing dimension must not reject a large legacy value.
  if (!Number.isFinite(value) || value < 0) throw new Error('Nieprawidłowa ilość.');
  if (value > 0 && value < 0.001) return value.toLocaleString('pl-PL', { maximumSignificantDigits: 4 });
  return value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
}
