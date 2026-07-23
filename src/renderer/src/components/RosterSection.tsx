import { useEffect, useRef, useState } from 'react'
import type { Roster } from '../../../shared/types'
import { mergeNames, parseImportInput } from '../../../shared/roster'

export function RosterSection(): React.JSX.Element {
  const [roster, setRoster] = useState<Roster>({ participants: [] })
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.minuting
      .getRoster()
      .then((r) => setRoster((r as Roster | null) ?? { participants: [] }))
      .catch(() => setError('참석자 목록을 불러오지 못했습니다.'))
  }, [])

  // 클립보드 복사 등 일시 알림은 잠시 후 자동으로 사라진다.
  useEffect(() => {
    if (notice === null) return
    const t = setTimeout(() => setNotice(null), 2000)
    return () => clearTimeout(t)
  }, [notice])

  // Export/Import 팝오버는 바깥을 클릭하면 닫는다.
  useEffect(() => {
    if (!exportOpen && !importOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (exportOpen && exportRef.current && !exportRef.current.contains(target)) setExportOpen(false)
      if (importOpen && importRef.current && !importRef.current.contains(target)) setImportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [exportOpen, importOpen])

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

  const toggleExport = (): void => { setImportOpen(false); setExportOpen((o) => !o) }
  // Import 팝오버는 열거나 닫을 때 항상 입력을 초기화해 매번 깨끗한 상태로 시작한다.
  const toggleImport = (): void => {
    setExportOpen(false)
    setImportText('')
    setError(null)
    setImportOpen((o) => !o)
  }

  const exportFile = async (): Promise<void> => {
    setExportOpen(false)
    try {
      const { saved } = await window.minuting.exportRosterFile()
      if (saved) setError(null)
    } catch {
      setError('내보내기에 실패했습니다.')
    }
  }
  const copyClipboard = async (): Promise<void> => {
    setExportOpen(false)
    try {
      await navigator.clipboard.writeText(JSON.stringify(roster, null, 2))
      setError(null)
      setNotice('클립보드에 복사되었습니다')
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
      setImportOpen(false)
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
      setImportOpen(false)
      setError(null)
    } catch {
      setError('참석자 목록을 교체하지 못했습니다.')
    }
  }

  return (
    <div className="setting-block">
      <div className="setting-label">참석자</div>

      <div className="roster-io">
        <div className="roster-popover-wrap" ref={exportRef}>
          <button type="button" className="btn-ghost" onClick={toggleExport} aria-expanded={exportOpen}>Export</button>
          {exportOpen && (
            <div className="roster-popover" role="menu">
              <button type="button" className="roster-popover-item" onClick={() => void exportFile()}>파일로</button>
              <button type="button" className="roster-popover-item" onClick={() => void copyClipboard()}>클립보드에 복사</button>
            </div>
          )}
        </div>

        <div className="roster-popover-wrap" ref={importRef}>
          <button type="button" className="btn-ghost" onClick={toggleImport} aria-expanded={importOpen}>Import</button>
          {importOpen && (
            <div className="roster-popover roster-import-popover">
              <button type="button" className="btn-ghost" onClick={() => void importFromFile()}>파일 불러오기</button>
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
                <div className="roster-import-preview">
                  <p className="env-desc">신규 {preview.added}명 · 중복 {preview.skipped}명 건너뜀 (총 {preview.names.length}명 입력)</p>
                  <div className="roster-import-buttons">
                    <button type="button" className="btn-primary" onClick={() => void applyMerge()}>병합</button>
                    <button type="button" className="btn-ghost" onClick={() => void applyReplace()}>전체 교체</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {notice && <span className="roster-toast">{notice}</span>}
      </div>

      {error && <p className="setting-error">{error}</p>}

      <div className="roster-panel">
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
          <p className="roster-empty">아직 등록된 참석자가 없습니다.</p>
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
                    <span className="roster-name">{name}</span>
                    <button type="button" className="icon-btn" aria-label="수정" onClick={() => startEdit(name)}>✎</button>
                    <button type="button" className="icon-btn" aria-label="삭제" onClick={() => void remove(name)}>×</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
