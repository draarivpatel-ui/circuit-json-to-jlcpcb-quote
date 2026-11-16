import { expect, test } from "bun:test"
import { lookupJlcParts } from "lib/index"
import type { BomLine, FetchLike } from "lib/index"
import {
  createFakeFetch,
  createFootprintShapes,
} from "./fixtures/create-fake-fetch"

const lookup = (bom: BomLine[], fetch: FetchLike) =>
  lookupJlcParts(bom, {
    fetch,
    jlcsearchBaseUrl: "https://jlcsearch.test",
  })

const line: BomLine = {
  designators: ["U1"],
  quantity: 1,
  comment: "PART7",
  requestedJlcPartNumber: "C7",
}

const jlcsearchComponent = {
  mfr: "PART7",
  package: "0603",
  is_basic: false,
  is_preferred: true,
  stock: 42,
  price: 0.5,
}

test("reads price, stock and flags from jlcsearch and pads from the footprint", async () => {
  const result = await lookup(
    [line],
    createFakeFetch({
      components: { C7: jlcsearchComponent },
      footprintShapes: {
        C7: createFootprintShapes({ smt: 2, throughHole: 3 }),
      },
    }),
  )
  expect(result.unresolvedBomLines).toEqual([])
  expect(result.pricedBom).toEqual([
    {
      ...line,
      matchMethod: "jlc_part_number",
      footprintJoints: { smt: 2, throughHole: 3 },
      part: {
        lcsc: "C7",
        mfr: "PART7",
        package: "0603",
        isBasic: false,
        isPreferred: true,
        unitPrice: 0.5,
        stock: 42,
        priceTiers: [],
        billing: null,
      },
    },
  ])
  // The input line is left untouched.
  expect(line).not.toHaveProperty("part")
})

test.each([
  "10-:0.4,1-9:0.5",
  '[{"qFrom":10,"qTo":null,"price":0.4},{"qFrom":1,"qTo":9,"price":0.5}]',
])("loads sorted catalog price breaks from %s", async (price) => {
  const result = await lookup(
    [line],
    createFakeFetch({
      catalogComponents: { C7: { ...jlcsearchComponent, price } },
      footprintShapes: {
        C7: createFootprintShapes({ smt: 2, throughHole: 0 }),
      },
    }),
  )
  expect(result.pricedBom[0]?.part).toMatchObject({
    unitPrice: 0.5,
    priceTiers: [
      { fromQuantity: 1, unitPrice: 0.5 },
      { fromQuantity: 10, unitPrice: 0.4 },
    ],
  })
})

test("prices a part without a footprint and reports parts that cannot be priced", async () => {
  const result = await lookup(
    [
      line,
      { designators: ["J1"], quantity: 1, comment: "pinrow4" },
      { ...line, designators: ["U2"], requestedJlcPartNumber: "C8" },
    ],
    createFakeFetch({ components: { C7: jlcsearchComponent } }),
  )
  expect(result.pricedBom).toHaveLength(1)
  expect(result.pricedBom[0]).toMatchObject({
    designators: ["U1"],
    part: { lcsc: "C7", unitPrice: 0.5 },
    footprintJoints: { smt: 0, throughHole: 1 },
  })
  expect(result.warnings).toEqual([
    "U1: no catalog footprint for C7. Estimated one manual solder joint per placement.",
  ])
  expect(
    result.unresolvedBomLines.map(({ line: unresolved, reason }) => [
      unresolved.designators.join(),
      reason,
    ]),
  ).toEqual([
    ["J1", "no JLCPCB part number"],
    ["U2", "C8 is not on jlcsearch"],
  ])
})

test("a malformed answer throws instead of being treated as not found", async () => {
  const brokenFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ error: "D1 query failed" }),
  })
  await expect(lookup([line], brokenFetch)).rejects.toThrow(
    "Unexpected answer from jlcsearch for C7",
  )
})
