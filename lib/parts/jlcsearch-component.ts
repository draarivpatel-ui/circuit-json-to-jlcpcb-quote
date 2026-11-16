import { z } from "zod"
import type { JlcPart } from "../types"
import { parseApiResponse } from "./parse-api-response"

/** A row of jlcsearch's /api/search and /<category>/list.json answers */
export const jlcsearchComponent = z.object({
  lcsc: z.number(),
  mfr: z.string(),
  package: z.string(),
  is_basic: z.boolean().nullish(),
  is_preferred: z.boolean().nullish(),
  stock: z.number().nullish(),
  price: z.number().nullish(),
  price1: z.number().nullish(),
})
export type JlcsearchComponent = z.infer<typeof jlcsearchComponent>

export const jlcsearchCatalogComponent = jlcsearchComponent.extend({
  price: z.string().nullish(),
})

const priceTierRows = z.array(
  z.object({
    qFrom: z.number().int().nonnegative(),
    price: z.number().finite().nonnegative(),
  }),
)

/** The catalog stores either JSON tiers or ranges such as "1-9:0.5,10-:0.4". */
export const parseJlcsearchPriceTiers = (
  price: string,
  source: string,
): JlcPart["priceTiers"] => {
  const compactTier = /^(\d+)-\d*:((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i
  const rows: unknown = price.startsWith("[")
    ? JSON.parse(price)
    : price.split(",").map((entry) => {
        const [, minimum, unitPrice] = compactTier.exec(entry.trim()) ?? []
        return { qFrom: Number(minimum), price: Number(unitPrice) }
      })
  return parseApiResponse({ schema: priceTierRows, json: rows, source })
    .map(({ qFrom, price }) => ({ fromQuantity: qFrom, unitPrice: price }))
    .sort((a, b) => a.fromQuantity - b.fromQuantity)
}

export const convertJlcsearchComponentToJlcPart = (
  component: JlcsearchComponent,
  priceTiers: JlcPart["priceTiers"] = [],
): JlcPart => {
  const unitPrice =
    priceTiers[0]?.unitPrice ?? component.price ?? component.price1
  if (unitPrice === null || unitPrice === undefined) {
    throw new Error(`jlcsearch lists no price for C${component.lcsc}`)
  }
  return {
    lcsc: `C${component.lcsc}`,
    mfr: component.mfr,
    package: component.package,
    isBasic: component.is_basic === true,
    isPreferred: component.is_preferred === true,
    unitPrice,
    stock: component.stock ?? null,
    priceTiers,
    // The catalog does not report billed spares.
    billing: null,
  }
}
