import hermesAvatarUrl from '../assets/brand/hermes-avatar.jpg'
import { cn } from '../lib/cn.ts'

export function HermesAvatar({
  size = 40,
  className,
  rounded = 10
}: {
  size?: number
  className?: string
  rounded?: number
}) {
  return (
    <img
      src={hermesAvatarUrl}
      alt="Hermes"
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 bg-paper object-cover shadow-[0_2px_10px_rgba(0,10,60,.45)]', className)}
      style={{ borderRadius: rounded }}
    />
  )
}
