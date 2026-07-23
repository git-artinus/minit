import { useEffect, useState } from 'react'
import type { Roster } from '../../../shared/types'
import { mergeNames, parseImportInput } from '../../../shared/roster'

export function RosterSection(): React.JSX.Element {
  const [roster, setRoster] = useState<Roster>({ participants: [] })
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    window.minuting.getRoster().then((r) => setRoster((r as Roster | null) ?? { participants: [] })).catch(() => {})
  }, [])

  const addNames = async (): Promise<void> => {
    const names = draft.split(/[\n,]/).map((n) => n.trim()).filter((n) => n !== '')
    if (names.length === 0) return
    try {
      const result = await window.minuting.mergeRoster(names)
      setRoster(result.roster)
      setDraft('')
      setError(null)
    } catch {
      setError('참석자를 추가하지 못했습니다.')
    }
  }

  const startEdit = (name: string): void => { setEditing(name); setEditValue(name) }
  const commitEdit = async (): Promise<void> => {
    if (editing === null) return
    try {
      const next = await window.minuting.renameRosterParticipant(editing, editValue)
      setRoster(next)
      setEditing(null)
      setError(null)
    } catch {
      setError('이름을 변경하지 못했습니다.')
    }
  }
  const remove = async (name: string): Promise<void> => {
    try {
      setRoster(await window.minuting.removeRosterParticipant(name))
      setError(null)
    } catch {
      setError('삭제하지 못했습니다.')
    }
  }

  // 붙여넣기/파일 내용을 파싱해 신규·중복 수를 미리 계산한다 — 저장 없이 shared 순수 함수로 dry-run.
  const preview = ((): { names: string[]; added: number; skipped: number } | null => {
    if (importText.trim() === '') return null
    try {
      const names = parseImportInput(importText)
      const { addedCount, skippedCount } = mergeNames(roster, names)
      return { names, added: addedCount, skipped: skippedCount }
    } catch {
      return null
    }
  })()

  const exportFile = async (): Promise<void> => {
    try {
      const { saved } = await window.minuting.exportRosterFile()
      if (saved) setError(null)
    } catch {
      setError('내보내기에 실패했습니다.')
    }
  }
  const copyClipboard = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(roster, null, 2))
      setError(null)
    } catch {
      setError('클립보드 복사에 실패했습니다.')
    }
  }
  const importFromFile = async (): Promise<void> => {
    try {
      const { names } = await window.minuting.importRosterFile()
      if (names) setImportText(names.join('\n'))
      setError(null)
    } catch {
      setError('파일을 불러오지 못했습니다. 이름 목록 또는 올바른 JSON 파일인지 확인하세요.')
    }
  }
  const applyMerge = async (): Promise<void> => {
    if (!preview) return
    try {
      setRoster((await window.minuting.mergeRoster(preview.names)).roster)
      setImportText('')
      setError(null)
    } catch {
      setError('참석자를 병합하지 못했습니다.')
    }
  }
  const applyReplace = async (): Promise<void> => {
    if (!preview) return
    if (!window.confirm(`현재 목록을 지우고 ${preview.names.length}명으로 교체합니다. 계속할까요?`)) return
    try {
      setRoster(await window.minuting.replaceRoster(preview.names))
      setImportText('')
      setError(null)
    } catch {
      setError('참석자 목록을 교체하지 못했습니다.')
    }
  }

  return (
    <div className="setting-block">
      <div className="setting-label">참석자</div>
      <p className="env-desc">회의 시작 없이도 참석자를 미리 등록·수정·삭제할 수 있습니다.</p>
      {error && <p className="setting-error">{error}</p>}

      <div className="roster-add">
        <input
          className="roster-add-field"
          value={draft}
          placeholder="이름 추가 (쉼표·줄바꿈으로 여러 명)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addNames() } }}
        />
        <button type="button" className="btn-primary" onClick={() => void addNames()}>추가</button>
      </div>

      {roster.participants.length === 0 ? (
        <p className="muted">아직 등록된 참석자가 없습니다.</p>
      ) : (
        <ul className="roster-list">
          {roster.participants.map((name) => (
            <li key={name} className="roster-row">
              {editing === name ? (
                <>
                  <input
                    className="roster-edit-field"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitEdit() }
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                  <button type="button" className="btn-ghost" onClick={() => void commitEdit()}>저장</button>
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>취소</button>
                </>
              ) : (
                <>
                  <span className="roster-name" onClick={() => startEdit(name)}>{name}</span>
                  <button type="button" className="icon-btn" aria-label="수정" onClick={() => startEdit(name)}>✎</button>
                  <button type="button" className="icon-btn" aria-label="삭제" onClick={() => void remove(name)}>×</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="roster-io">
        <div className="roster-io-row">
          <button type="button" className="btn-ghost" onClick={() => void exportFile()}>파일로 내보내기</button>
          <button type="button" className="btn-ghost" onClick={() => void copyClipboard()}>클립보드 복사</button>
          <button type="button" className="btn-ghost" onClick={() => void importFromFile()}>파일 불러오기</button>
        </div>
        <textarea
          className="roster-import-text"
          value={importText}
          placeholder="이름을 붙여넣으세요 (줄바꿈/쉼표 구분, 또는 participants.json 내용)"
          onChange={(e) => setImportText(e.target.value)}
        />
        {importText.trim() !== '' && (preview === null || preview.names.length === 0) && (
          <p className="setting-error">형식을 인식할 수 없습니다. 이름 목록 또는 올바른 JSON을 붙여넣으세요.</p>
        )}
        {preview && preview.names.length > 0 && (
          <div className="roster-import-actions">
            <p className="env-desc">신규 {preview.added}명 · 중복 {preview.skipped}명 건너뜀 (총 {preview.names.length}명 입력)</p>
            <button type="button" className="btn-primary" onClick={() => void applyMerge()}>병합</button>
            <button type="button" className="btn-ghost" onClick={() => void applyReplace()}>전체 교체</button>
          </div>
        )}
      </div>
    </div>
  )
}
