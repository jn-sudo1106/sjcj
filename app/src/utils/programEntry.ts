export function isProgramEntry(path: string): boolean {
  return /\.(py|exe)$/i.test(path) && path.split(/[\\/]/).at(-1)?.toLowerCase() !== '__init__.py'
}
