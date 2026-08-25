export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3,7 L6,10.5 L11,3.5" stroke="#2f5233" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3,3 L11,11 M11,3 L3,11" stroke="#8b2c1a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function SkipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3,4 A5,5 0 1 1 3,10" stroke="#9a9686" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M3,1 L3,5 L7,5" stroke="#9a9686" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function NoteIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke="#1a1a1a" strokeWidth="1.6" aria-hidden="true">
      <circle cx="11" cy="11" r="9" />
      <path d="M8 12.5 L8 8 L14 6.5 L14 11" />
      <circle cx="8" cy="13" r="1.6" />
      <circle cx="14" cy="12" r="1.6" />
    </svg>
  )
}
