import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { api, type UserMe, userSatisfies2faPolicy } from '@/lib/api'

export function TwoFactorBanner({ user }: { user: UserMe | null }) {
  if (!user || userSatisfies2faPolicy(user)) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2">
      <div className="flex items-start gap-2 text-sm text-warn">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-medium">2FA required for proxy and telemetry.</span>{' '}
          <span className="text-dim">
            Local hosts and direct SSH work now. Core will not let this client bypass TOTP.
          </span>
        </p>
      </div>
      <Button
        variant="outline"
        className="!border-warn/40 !text-warn !text-xs"
        onClick={() => void api.openWebPath('security/2fa')}
      >
        Enable 2FA
      </Button>
    </div>
  )
}
