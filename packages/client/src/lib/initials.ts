/**
 * Initials from `displayName`: first letter of the first word + first letter
 * of the last word, uppercased. Single-word names use just that one letter.
 */
export function displayInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
  const first = words.at(0)
  const last = words.at(-1)
  if (first === undefined || last === undefined) {
    return ''
  }
  const firstLetter = first.charAt(0).toUpperCase()
  if (words.length === 1) {
    return firstLetter
  }
  return `${firstLetter}${last.charAt(0).toUpperCase()}`
}
