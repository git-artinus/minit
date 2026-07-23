import { useEffect, useState } from 'react'
import type { Roster } from '../../../shared/types'

export function RosterSection(): React.JSX.Element {
  const [roster, setRoster] = useState<Roster>({ participants: [] })
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)

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
    </div>
  )
}
