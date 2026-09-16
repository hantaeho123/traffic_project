import { LEVEL_CLASS } from '../lib/format'

export default function LevelBadge({ level }: { level: string | null | undefined }) {
  if (!level) return <span className="badge none">대기</span>
  return <span className={`badge ${LEVEL_CLASS[level] ?? 'none'}`}>{level}</span>
}
