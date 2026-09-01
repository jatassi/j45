/**
 * The words for one facet summary line, one case for each state a selection
 * can be in.
 *
 * A summary line makes the meaning of a selection visible. The equipment field
 * uses this module now. The Emphasis field gets its own line later, and it
 * gives its own words. The two empty states of this form mean the opposite of
 * each other: an empty kit is bodyweight only, and an absent Emphasis is no
 * filter at all. The words must therefore differ, but the cases are the same
 * shape, so this module chooses the case and the field supplies the words.
 *
 * `all` is optional. The equipment field gives it, because the full kit reads
 * better in words than as `16 of 16`. A field that gives no `all` shows the
 * `some` case for a full selection.
 */
export type FacetSummaryCases = {
  readonly none: string
  readonly some: (selected: number, total: number) => string
  readonly all?: string
}

/**
 * Chooses the case for a selection of `selected` values out of `total`.
 */
export const facetSummary = (cases: FacetSummaryCases, selected: number, total: number): string => {
  if (selected === 0) return cases.none
  if (selected === total && cases.all !== undefined) return cases.all
  return cases.some(selected, total)
}
