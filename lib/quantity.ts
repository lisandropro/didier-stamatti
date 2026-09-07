export const MAX_QUANTITY = 2_147_483_647;
export function validQuantity(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= MAX_QUANTITY;
}
