import { expect, test, vi } from 'vitest'
import { fallbackImageOcr, timeLeft, type LocalRunner } from './local-ocr'
const base = { deadline: 1000, now: () => 0, candidates: ['/local/tesseract'] }
test('English-only fallback stays partial and never invents Korean support', async () => {
  const run = vi.fn<LocalRunner>().mockResolvedValueOnce('List (2):\neng\nosd\n').mockResolvedValueOnce('BC 457\nAD 34')
  const r = await fallbackImageOcr('/owned/input.png', { ...base, run })
  expect(r.partial).toBe(true)
  expect(r.truncated).toBe(false)
  expect(r.units[0].text).toContain('BC 457')
  expect(r.warnings.join('')).toContain('한국어 인식 자료가 없어')
  expect(run.mock.calls[1][1]).toEqual(['/owned/input.png', 'stdout', '-l', 'eng', '--psm', '11'])
})
test('installed Korean and English packs are both used without a download', async () => {
  const run = vi.fn<LocalRunner>().mockResolvedValueOnce('eng\nkor\nosd\n').mockResolvedValueOnce('한글 English')
  const r = await fallbackImageOcr('/owned/input.png', { ...base, run })
  expect(r.units[0].text).toBe('한글 English')
  expect(run.mock.calls[1][1]).toContain('kor+eng')
  expect(r.partial).toBe(true)
  expect(r.warnings.join('')).not.toContain('한국어 인식 자료가 없어')
})
test('no-text, engine failure, missing engine, timeout and cancellation are distinct', async () => {
  for (const result of [' \n', '— !']) {
    const run = vi.fn<LocalRunner>().mockResolvedValueOnce('eng\n').mockResolvedValueOnce(result)
    await expect(fallbackImageOcr('/input', { ...base, run })).rejects.toThrow('no_text')
  }
  const failed = vi.fn<LocalRunner>().mockResolvedValueOnce('eng\n').mockRejectedValueOnce(Error('private detail'))
  await expect(fallbackImageOcr('/input', { ...base, run: failed })).rejects.toThrow('ocr_failed')
  await expect(
    fallbackImageOcr('/input', { ...base, run: vi.fn().mockRejectedValue(Error('missing')) })
  ).rejects.toThrow('ocr_unavailable')
  for (const code of ['extraction_timeout', 'extraction_cancelled']) {
    const run = vi.fn<LocalRunner>().mockResolvedValueOnce('eng\n').mockRejectedValueOnce(Error(code))
    await expect(fallbackImageOcr('/input', { ...base, run })).rejects.toThrow(code)
  }
})
test('one read deadline and character cap apply; aborted reads never execute', async () => {
  const run = vi.fn<LocalRunner>().mockResolvedValueOnce('eng').mockResolvedValueOnce('a'.repeat(200001))
  const r = await fallbackImageOcr('/input', { ...base, run })
  expect(r.truncated).toBe(true)
  expect(r.units[0].text).toHaveLength(200000)
  expect(run.mock.calls.every(v => v[2] > 0 && v[2] <= 1000)).toBe(true)
  const controller = new AbortController()
  controller.abort()
  const none = vi.fn()
  await expect(fallbackImageOcr('/input', { ...base, signal: controller.signal, run: none })).rejects.toThrow(
    'cancelled'
  )
  expect(none).not.toHaveBeenCalled()
  expect(() => timeLeft(1, () => 1)).toThrow('extraction_timeout')
})
