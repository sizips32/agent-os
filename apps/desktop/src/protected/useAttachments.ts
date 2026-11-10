import { useRef, useState } from 'react'
import type { AttachmentPreview } from '../../protected/types.ts'

const ATTACHMENT_ERRORS: Record<string, string> = {
  attachment_limit: '첨부는 최대 8개입니다.',
  protected_file: '설정·인증·기억 등 보호 파일은 첨부하지 않습니다.',
  unsupported_file: 'TXT·MD·CSV·JSON·PDF·DOCX·XLSX·PPTX·JPEG·PNG·WebP를 지원합니다.',
  legacy_document: '구형 DOC·XLS·PPT는 안전한 읽기가 미검증입니다. DOCX·XLSX·PPTX로 저장해 주세요.',
  encrypted_file: '암호화 문서는 읽지 않습니다. 암호 없는 사본을 직접 선택해 주세요.',
  invalid_document: '손상되었거나 확장자와 실제 형식이 다른 문서입니다.',
  no_text: '읽을 수 있는 글자가 없습니다. OCR은 사진·도표의 의미 분석이 아닙니다.',
  document_limit: '페이지·셀·압축 해제·이미지 크기가 로컬 안전 한도를 초과했습니다.',
  active_content: '매크로·임베디드 개체·외부 데이터 참조가 포함되어 읽지 않습니다.',
  extraction_failed: '로컬 추출이 실패했거나 90초 제한을 초과했습니다. 외부 서비스로 보내지 않습니다.',
  extraction_unavailable: '로컬 문서 읽기 도구를 사용할 수 없습니다.',
  ocr_failed:
    '이미지/문서는 읽었지만 로컬 OCR 인식에 실패했습니다. 파일 손상으로 판정하지 않으며 외부로 보내지 않습니다.',
  ocr_unavailable: '이미지는 읽었지만 사용 가능한 로컬 OCR 인식기를 찾지 못했습니다. 외부로 보내지 않습니다.',
  extraction_timeout: '로컬 읽기의 90초 한도를 넘었습니다. 파일 손상으로 판정하지 않으며 외부로 보내지 않습니다.',
  one_image_only: '이미지는 1개만 첨부할 수 있습니다.',
  file_size: '빈 파일 또는 크기 초과입니다. 텍스트 64KiB, 문서 16MiB, 이미지 5MiB 이내입니다.',
  utf8_required: 'UTF-8 텍스트 파일만 지원합니다.',
  text_limit: '첨부 텍스트는 12,000자 이내여야 합니다.',
  invalid_image: '확인할 수 없는 이미지입니다.',
  busy: '요청 중에는 첨부할 수 없습니다.'
}

type Blocked = { pick: () => boolean; remove: () => boolean; range: () => boolean }

/**
 * Owns the selected-attachment list and its local-read lifecycle. `blocked` is evaluated at call time
 * so callers can consult state declared after the hook.
 */
export function useAttachments({ blocked, reportError }: { blocked: Blocked; reportError: (message: string) => void }) {
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([])
  const attachmentRef = useRef<AttachmentPreview[]>([])
  const readGeneration = useRef(0)
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState('')
  function replaceAttachments(items: AttachmentPreview[]) {
    attachmentRef.current = items
    setAttachments(items)
  }
  async function clearAttachments() {
    ++readGeneration.current
    const ids = attachmentRef.current.map(item => item.id)
    replaceAttachments([])
    await window.protectedHerald.cancelAttachmentRead()
    const results = await Promise.allSettled(ids.map(id => window.protectedHerald.removeAttachment(id)))
    if (results.some(item => item.status === 'rejected'))
      reportError('첨부 정리를 확인하지 못했습니다. 자동 재전송하지 않습니다.')
  }
  async function pickAttachment() {
    if (picking || blocked.pick()) return
    const generation = readGeneration.current
    setPicking(true)
    setNotice('')
    try {
      const choice = await window.protectedHerald.pickAttachment()
      if (generation !== readGeneration.current) {
        if (choice.item) await window.protectedHerald.removeAttachment(choice.item.id)
        return
      }
      if (choice.error) {
        setNotice(
          (choice.name ? `${choice.name}: ` : '') +
            (ATTACHMENT_ERRORS[choice.error] || '파일을 읽지 못했습니다. 다시 선택해 주세요.')
        )
      } else if (choice.item) replaceAttachments([...attachmentRef.current, choice.item])
    } catch {
      setNotice('파일 선택을 완료하지 못했습니다. 자동 전송하지 않습니다.')
    } finally {
      setPicking(false)
    }
  }
  async function removeAttachment(id: string) {
    if (blocked.remove()) return
    try {
      await window.protectedHerald.removeAttachment(id)
      replaceAttachments(attachmentRef.current.filter(item => item.id !== id))
    } catch {
      setNotice('첨부 제거를 확인하지 못했습니다. 전송 전에 다시 확인하세요.')
    }
  }
  async function cancelAttachmentRead() {
    ++readGeneration.current
    await window.protectedHerald.cancelAttachmentRead()
    setPicking(false)
    setNotice('로컬 첨부 읽기를 취소했습니다. 전송하지 않았습니다.')
  }
  async function selectAttachmentRange(item: AttachmentPreview, start: number, end: number, confirmed: boolean) {
    if (blocked.range()) return
    setPicking(true)
    try {
      const updated = await window.protectedHerald.setAttachmentRange(item.id, start, end, confirmed)
      if (attachmentRef.current.some(v => v.id === item.id))
        replaceAttachments(attachmentRef.current.map(v => (v.id === item.id ? updated : v)))
      setNotice('')
    } catch {
      setNotice('추출 내용 안에서 전송할 1~12,000자를 선택해 주세요. 전체 요청 한도도 적용됩니다.')
    } finally {
      setPicking(false)
    }
  }
  /** Invalidates in-flight reads and releases staged files; used on unmount. */
  function dispose() {
    ++readGeneration.current
    for (const item of attachmentRef.current) void window.protectedHerald.removeAttachment(item.id).catch(() => {})
  }
  return {
    attachments,
    picking,
    notice,
    setNotice,
    clearAttachments,
    pickAttachment,
    removeAttachment,
    cancelAttachmentRead,
    selectAttachmentRange,
    dispose
  }
}
