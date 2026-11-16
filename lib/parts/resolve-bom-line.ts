import type { BomLine, LcscPartNumber, PricedBomLine } from "../types"
import { fetchFootprintJoints } from "./fetch-footprint-joints"
import { fetchJlcsearchPart } from "./fetch-jlcsearch-part"
import { findPassiveOnJlcsearch } from "./find-passive-on-jlcsearch"
import type { LookupContext } from "./lookup-context"

export type BomLineResolution =
  | { status: "priced"; line: PricedBomLine; assumedManualJoint: boolean }
  | { status: "unresolved"; line: BomLine; reason: string }

/**
 * Find the catalog part and pad counts. A missing footprint defaults to one
 * manual joint per placement. Network and format failures still throw.
 */
export const resolveBomLine = async (
  line: BomLine,
  ctx: LookupContext,
): Promise<BomLineResolution> => {
  let lcsc: LcscPartNumber | null = line.requestedJlcPartNumber ?? null
  let matchMethod: PricedBomLine["matchMethod"] = "jlc_part_number"
  if (!lcsc && line.passiveLookup) {
    lcsc = await findPassiveOnJlcsearch(line.passiveLookup, ctx)
    matchMethod = "passive_spec"
  }
  if (!lcsc) {
    return {
      status: "unresolved",
      line,
      reason: line.passiveLookup
        ? "no JLCPCB part with that rating and package"
        : "no JLCPCB part number",
    }
  }

  // Both only need the part number, so they are fetched together.
  const [part, footprintJoints] = await Promise.all([
    fetchJlcsearchPart(lcsc, ctx),
    fetchFootprintJoints(lcsc, ctx),
  ])
  if (!part) {
    return { status: "unresolved", line, reason: `${lcsc} is not on jlcsearch` }
  }
  return {
    status: "priced",
    line: {
      ...line,
      part,
      matchMethod,
      footprintJoints: footprintJoints ?? { smt: 0, throughHole: 1 },
    },
    assumedManualJoint: footprintJoints === null,
  }
}
