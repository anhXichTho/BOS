// Type stub for mammoth's browser bundle — the package ships its own
// types for the main entry but not for the browser path.
declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
  const _default: { extractRawText: typeof extractRawText }
  export default _default
}
