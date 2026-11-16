import { estimatedPartBilling } from "../jlcpcb-price-table"
import type {
  JlcPart,
  LcscPartNumber,
  PricedBomLine,
  QuoteSection,
} from "../types"
import { createQuoteLineItem } from "./create-quote-line-item"

/**
 * How many pieces JLCPCB bills. Basic parts are billed exactly as used.
 * Extended parts are billed with spares, up to a minimum quantity. When the
 * part source does not report those, they are estimated from the unit price.
 */
export const getBilledQuantity = (part: JlcPart, usedQuantity: number) => {
  if (part.isBasic) return usedQuantity
  if (part.billing) {
    return Math.max(
      usedQuantity + part.billing.spareQuantity,
      part.billing.minimumQuantity,
    )
  }
  if (part.unitPrice < estimatedPartBilling.cheapUnitPriceBelow) {
    return Math.max(
      usedQuantity + estimatedPartBilling.cheapSpareQuantity,
      estimatedPartBilling.cheapMinimumQuantity,
    )
  }
  if (part.unitPrice < estimatedPartBilling.midUnitPriceBelow) {
    return usedQuantity + estimatedPartBilling.midSpareQuantity
  }
  return usedQuantity
}

/** The price break that applies to a billed quantity. */
export const getUnitPriceForQuantity = (part: JlcPart, quantity: number) =>
  part.priceTiers.findLast((tier) => quantity >= tier.fromQuantity)
    ?.unitPrice ?? part.unitPrice

export const getBilledPartsByNumber = (order: {
  bom: PricedBomLine[]
  assembledQuantity: number
}) => {
  const partsByNumber = new Map<
    LcscPartNumber,
    Pick<PricedBomLine, "part" | "quantity" | "designators">
  >()
  for (const { part, quantity, designators } of order.bom) {
    const group = partsByNumber.get(part.lcsc)
    if (group) {
      group.quantity += quantity
      group.designators.push(...designators)
    } else {
      partsByNumber.set(part.lcsc, {
        part,
        quantity,
        designators: [...designators],
      })
    }
  }
  return new Map(
    Array.from(partsByNumber, ([lcsc, { part, quantity, designators }]) => {
      const usedQuantity = quantity * order.assembledQuantity
      const billedQuantity = getBilledQuantity(part, usedQuantity)
      const unitPrice = getUnitPriceForQuantity(part, billedQuantity)
      return [
        lcsc,
        { part, designators, usedQuantity, billedQuantity, unitPrice },
      ] as const
    }),
  )
}

export const estimatePartsCost = (order: {
  bom: PricedBomLine[]
  assembledQuantity: number
}): QuoteSection => {
  const warnings: string[] = []
  let partsCost = 0
  let partsCostWithoutSpares = 0
  let partsWithEstimatedBilling = 0
  const billedParts = getBilledPartsByNumber(order)
  for (const {
    part,
    designators,
    usedQuantity,
    billedQuantity,
    unitPrice,
  } of billedParts.values()) {
    partsCost += billedQuantity * unitPrice
    partsCostWithoutSpares += usedQuantity * unitPrice
    if (!part.isBasic && !part.billing) partsWithEstimatedBilling++
    if (part.stock !== null && part.stock < billedQuantity) {
      warnings.push(
        `${designators.join(",")}: ${part.lcsc} has ${part.stock} in stock at JLCPCB, ${billedQuantity} needed`,
      )
    }
  }
  const label = `Parts for ${order.assembledQuantity} boards (${billedParts.size} unique)`
  return {
    lineItems: [
      partsWithEstimatedBilling === 0
        ? createQuoteLineItem({
            category: "components",
            key: "components",
            label,
            cost: partsCost,
            confidence: "quoted",
          })
        : createQuoteLineItem({
            category: "components",
            key: "components",
            label,
            cost: partsCost,
            lowCost:
              partsCostWithoutSpares * estimatedPartBilling.range.lowFraction,
            highCost: partsCost * estimatedPartBilling.range.highFraction,
            confidence: "calibrated",
            note: `Estimated spares for ${partsWithEstimatedBilling} of ${billedParts.size} part types`,
          }),
    ],
    warnings,
  }
}
