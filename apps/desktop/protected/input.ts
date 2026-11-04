export function prepareInput(text: unknown, requestId: unknown): asserts text is string {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 12000 ||
    text.includes('\0') ||
    typeof requestId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(requestId)
  )
    throw Error('Invalid request')
}
