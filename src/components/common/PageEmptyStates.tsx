import type { ReactNode } from 'react'
import { BarChart3, CheckCircle2, Clock3, FilePenLine, Lock, Plus, Send, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyActionProps {
  onAdd?: () => void
  onImport?: () => void
  onPrimary?: () => void
  onSecondary?: () => void
}

function EmptyShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[22rem] items-center justify-center p-6 text-center', className)}>
      {children}
    </div>
  )
}

export function VaultEmptyState({ onAdd, onImport }: EmptyActionProps) {
  return (
    <EmptyShell>
      <div className="w-full max-w-sm rounded-2xl border border-border/40 bg-card/80 p-8 shadow-[inset_0_0.5px_0_hsl(0_0%_100%/0.06),0_18px_80px_hsl(var(--background)/0.35)]">
        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-[1.35rem] border border-primary/25 bg-primary/12" />
          <Shield className="relative h-9 w-9 text-primary" />
          <Lock className="absolute bottom-5 right-5 h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="text-lg font-bold tracking-tight">Your vault is empty</h3>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
          Store debrid keys, API tokens, and addon secrets here. Everything stays encrypted with your master password.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {onAdd && (
            <Button onClick={onAdd} className="h-10 w-full rounded-xl gap-2">
              <Plus className="h-4 w-4" />
              Add your first key
            </Button>
          )}
          {onImport && (
            <Button variant="outline" onClick={onImport} className="h-9 w-full rounded-xl gap-2">
              <Send className="h-4 w-4" />
              Import from JSON
            </Button>
          )}
        </div>
      </div>
    </EmptyShell>
  )
}

export function NotesEmptyState({ onAdd }: EmptyActionProps) {
  return (
    <EmptyShell>
      <div className="w-full max-w-md">
        <div className="relative mx-auto mb-7 h-40 w-52">
          <div className="absolute inset-x-5 bottom-0 top-5 rotate-[-4deg] rounded-xl border border-border/50 bg-white/[0.04]" />
          <div className="absolute inset-x-3 bottom-2 top-2 rotate-[2deg] rounded-xl border border-border/50 bg-white/[0.06]" />
          <div className="absolute inset-0 rounded-xl border border-border/60 bg-card p-5 shadow-xl">
            <div className="mb-4 h-2 w-3/5 rounded-full bg-muted-foreground/25" />
            <div className="space-y-2">
              <div className="h-1.5 rounded-full bg-muted-foreground/15" />
              <div className="h-1.5 w-11/12 rounded-full bg-muted-foreground/15" />
              <div className="h-1.5 w-8/12 rounded-full bg-muted-foreground/15" />
            </div>
            <div className="mt-5 text-4xl font-extralight leading-none text-muted-foreground/35">+</div>
          </div>
        </div>
        <h3 className="text-2xl font-bold tracking-tight">Nothing written yet.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Capture API keys, addon configs, debrid tricks, anything. Notes sync end-to-end encrypted across your devices.
        </p>
        {onAdd && (
          <Button onClick={onAdd} className="mt-6 h-10 rounded-xl px-6 gap-2">
            <FilePenLine className="h-4 w-4" />
            Write your first note
          </Button>
        )}
      </div>
    </EmptyShell>
  )
}

export function ActivityEmptyState({ onPrimary, onSecondary }: EmptyActionProps) {
  return (
    <EmptyShell>
      <div className="w-full max-w-lg">
        <div className="relative mx-auto mb-8 max-w-md px-5">
          <div className="absolute bottom-2 left-6 top-2 w-px bg-gradient-to-b from-transparent via-border to-transparent" />
          {[0.62, 0.44, 0.28, 0.16].map((opacity, index) => (
            <div key={index} className="flex items-center gap-4 py-2" style={{ opacity }}>
              <span className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full bg-info" />
              <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border/40 bg-white/[0.03] px-3">
                <span className="h-4 w-4 rounded bg-muted/40" />
                <span className="h-1.5 rounded-full bg-muted-foreground/20" style={{ width: `${[60, 75, 45, 80][index]}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-info">Waiting for activity</div>
        <h3 className="text-xl font-bold tracking-tight">Watch something to fill this timeline.</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Every movie and episode you watch across your connected platforms shows up here.
        </p>
        {(onPrimary || onSecondary) && (
          <div className="mt-6 flex justify-center gap-2">
            {onPrimary && <Button onClick={onPrimary} className="rounded-xl">Connect a platform</Button>}
            {onSecondary && <Button variant="outline" onClick={onSecondary} className="rounded-xl">How sync works</Button>}
          </div>
        )}
      </div>
    </EmptyShell>
  )
}

export function LibraryEmptyState({ onAdd, onImport }: EmptyActionProps) {
  return (
    <EmptyShell className="min-h-[30rem]">
      <div className="w-full max-w-lg">
        <div className="mx-auto mb-7 grid max-w-md grid-cols-3 gap-2.5 opacity-45">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="aspect-square rounded-2xl border border-border/40 bg-card/80 p-3">
              <div className="mb-3 h-8 w-8 rounded-lg bg-muted/40" />
              <div className="mb-2 h-1.5 w-8/12 rounded-full bg-muted-foreground/20" />
              <div className="h-1 w-1/2 rounded-full bg-muted-foreground/15" />
            </div>
          ))}
        </div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-info">Library is empty</div>
        <h3 className="text-xl font-bold tracking-tight">Save addons once. Deploy anywhere.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Build a personal catalog of addons you trust. Tag them, group them by profile, then push to any account in one click.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {onAdd && (
            <Button onClick={onAdd} className="rounded-xl gap-2">
              <Plus className="h-4 w-4" />
              Save first addon
            </Button>
          )}
          {onImport && <Button variant="outline" onClick={onImport} className="rounded-xl">Import from account</Button>}
        </div>
      </div>
    </EmptyShell>
  )
}

export function FailoverEmptyState({
  rulesCount = 0,
  addonsCount = 0,
  onPrimary,
  onSecondary,
}: EmptyActionProps & { rulesCount?: number; addonsCount?: number }) {
  return (
    <EmptyShell>
      <div className="w-full max-w-md rounded-2xl border border-dashed border-success/30 bg-success/[0.04] p-8 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-success/30 bg-success/12 text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-bold tracking-tight">No failovers yet</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          {rulesCount === 0 ? (
            <>No Autopilot rules configured. Create a rule to start monitoring addon health and automatic failover.</>
          ) : addonsCount === 0 ? (
            <>Autopilot has <strong className="text-foreground">{rulesCount} rules</strong> but no addons to monitor.</>
          ) : (
            <>Autopilot is watching <strong className="text-foreground">{addonsCount} addons</strong> across{' '}
            <strong className="text-foreground">{rulesCount} rules</strong>. When one goes down, the recovery log will appear here.</>
          )}
        </p>
        {(onPrimary || onSecondary) && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {onPrimary && <Button variant="outline" size="sm" onClick={onPrimary} className="rounded-xl">View rules</Button>}
            {onSecondary && <Button variant="outline" size="sm" onClick={onSecondary} className="rounded-xl">Health check now</Button>}
          </div>
        )}
      </div>
    </EmptyShell>
  )
}

export function ReplayEmptyState({ year = new Date().getFullYear() }: { year?: number }) {
  return (
    <EmptyShell className="min-h-[28rem] rounded-2xl bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.16),transparent_55%),linear-gradient(180deg,hsl(var(--card)/0.85),hsl(var(--background)/0.55))]">
      <div className="max-w-md">
        <div className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.22em] text-primary">
          <Clock3 className="mr-2 inline h-3.5 w-3.5" />
          Replay {year}
        </div>
        <div className="mb-4 bg-gradient-to-br from-primary via-warning to-destructive bg-clip-text text-8xl font-black leading-none tracking-[-0.06em] text-transparent">
          0h
        </div>
        <h3 className="text-2xl font-bold tracking-tight">The reel is still empty.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Replay lights up once we log your first watch of the year. Press play on something and the recap will start building.
        </p>
      </div>
    </EmptyShell>
  )
}

export function MetricsEmptyState() {
  return (
    <EmptyShell className="min-h-[28rem]">
      <div className="w-full max-w-lg">
        <div className="mx-auto mb-7 flex max-w-sm items-end justify-center gap-2 opacity-45">
          {[40, 64, 32, 80, 52, 72].map((height, index) => (
            <div
              key={index}
              className="w-8 rounded-t-lg bg-gradient-to-t from-primary/30 to-primary/10"
              style={{ height }}
            />
          ))}
        </div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-info">No metrics yet</div>
        <h3 className="text-xl font-bold tracking-tight">Your viewing stats build as you watch.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Charts, trends, and milestones appear automatically once watch activity lands from your connected platforms.
        </p>
        <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-border/40 bg-card/60 px-4 py-2 text-xs font-medium text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          Tracking across all your platforms
        </div>
      </div>
    </EmptyShell>
  )
}
