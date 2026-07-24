import type { SlackChannel } from '../../../shared/types'

// 설정 화면과 회의시작 모달이 공유하는 채널 선택 <select>.
// 공개/비공개로 나눠 이름순 정렬한 optgroup을 렌더한다. optgroup 앞의 옵션(선택 안내·기본값·발송 안 함 등)은
// 소비자가 leading으로 주입한다. selectSlackChannel/override 등 선택 처리 로직은 소비자에게 위임한다.
export function SlackChannelSelect(props: {
  channels: SlackChannel[] | null
  value: string
  onChange: (value: string) => void
  onFocus?: () => void
  leading?: React.ReactNode
}): React.JSX.Element {
  const byName = (a: SlackChannel, b: SlackChannel): number => a.name.localeCompare(b.name)
  const publicChannels = (props.channels ?? []).filter((c) => !c.isPrivate).sort(byName)
  const privateChannels = (props.channels ?? []).filter((c) => c.isPrivate).sort(byName)
  return (
    <select value={props.value} onFocus={props.onFocus} onChange={(e) => props.onChange(e.target.value)}>
      {props.leading}
      {publicChannels.length > 0 && (
        <optgroup label="공개">
          {publicChannels.map((c) => (
            <option key={c.id} value={c.id}># {c.name}</option>
          ))}
        </optgroup>
      )}
      {privateChannels.length > 0 && (
        <optgroup label="비공개">
          {privateChannels.map((c) => (
            <option key={c.id} value={c.id}>🔒 {c.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
