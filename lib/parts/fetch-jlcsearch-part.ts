import { z } from "zod"
import type { JlcPart, LcscPartNumber } from "../types"
import { fetchJsonWithRetry } from "./fetch-json-with-retry"
import {
  convertJlcsearchComponentToJlcPart,
  jlcsearchCatalogComponent,
  jlcsearchComponent,
  parseJlcsearchPriceTiers,
} from "./jlcsearch-component"
import type { LookupContext } from "./lookup-context"
import { parseApiResponse } from "./parse-api-response"

const searchResponse = z.object({ components: z.array(jlcsearchComponent) })
const catalogResponse = z.object({
  components: z.array(jlcsearchCatalogComponent),
})

/**
 * Read the exact catalog part and its price tiers. Search can supply a unit
 * price when the catalog has no pricing for that part.
 */
export const fetchJlcsearchPart = async (
  lcsc: LcscPartNumber,
  ctx: LookupContext,
): Promise<JlcPart | null> => {
  const source = `jlcsearch for ${lcsc}`
  const catalogUrl = `${ctx.jlcsearchBaseUrl}/components/list.json?search=${lcsc}&full=true&limit=5`
  const catalog = await fetchJsonWithRetry({ url: catalogUrl }, ctx)
  const catalogParts =
    catalog.status === 404
      ? []
      : parseApiResponse({
          schema: catalogResponse,
          json: catalog.json,
          source,
        }).components
  const catalogPart = catalogParts.find(
    (candidate) => `C${candidate.lcsc}` === lcsc,
  )
  const price = catalogPart?.price?.trim()
  if (catalogPart && price) {
    const unitPrice = Number(price)
    if (Number.isFinite(unitPrice) && unitPrice >= 0) {
      return convertJlcsearchComponentToJlcPart({
        ...catalogPart,
        price: unitPrice,
      })
    }
    const priceTiers = parseJlcsearchPriceTiers(price, source)
    if (priceTiers.length > 0) {
      return convertJlcsearchComponentToJlcPart(
        { ...catalogPart, price: null },
        priceTiers,
      )
    }
  }

  const url = `${ctx.jlcsearchBaseUrl}/api/search?q=${lcsc}&limit=20`
  const { json, status } = await fetchJsonWithRetry({ url }, ctx)
  if (status === 404) return null
  const { components } = parseApiResponse({
    schema: searchResponse,
    json,
    source,
  })
  const component = components.find(
    (candidate) => `C${candidate.lcsc}` === lcsc,
  )
  return component ? convertJlcsearchComponentToJlcPart(component) : null
}
