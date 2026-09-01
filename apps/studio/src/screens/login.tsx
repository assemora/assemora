/**
 * The login screen (SPEC.md §115).
 *
 * It sends credentials to `/auth/login` and nothing else. The command behind that
 * endpoint decides what a wrong password means, how long it takes to say so, and what is
 * written to the audit trail — none of which is Studio's business.
 *
 * `design_handoff_studio_redesign` §1: two panels 8px apart on the canvas, the form on
 * the left over a 336px column, the chrome-coloured statement on the right. The handoff
 * draws five states; four of them — a second factor, a reset link, a sent confirmation
 * and an SSO-only workspace — are doors `@assemora/auth` does not have, and its
 * "keep me signed in for 30 days" is a length `auth.login` does not take. A control
 * that reaches nothing is worse than an absent one: somebody ticks it, is signed out
 * the next morning, and now distrusts the screen rather than the missing feature. So
 * what is here is the state the application can actually answer, and the rest arrives
 * with the commands behind it.
 */
import { CircleAlert, Eye, EyeOff } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { ApiError, unshownMessages } from '../api/client.ts'
import { useSession } from '../api/session.tsx'
import { Button } from '../ui/index.tsx'
import { Logo } from '../ui/logo.tsx'

/**
 * What to put on the screen when signing in did not work.
 *
 * One sentence is Studio's own and deliberately so: a 401 must read the same whether
 * the address is unknown or the password is wrong, because a login screen that can tell
 * the two apart is an account enumerator (SPEC.md §86, docs/rules/security.md).
 *
 * Everything else is the application's to say, and used to be replaced by "Please try
 * again" — advice that is simply wrong for the two answers a login most often gets
 * after a wrong password: a rate limit (SPEC.md §85), which needs waiting rather than
 * retrying, and a validation failure, which needs a different address typed in.
 */
export const signInFailure = (error: unknown): string => {
  if (!(error instanceof ApiError)) return 'Could not sign in. Please try again.'
  if (error.status === 401) return 'That email and password do not match.'

  const said = [error.message, ...unshownMessages(error)].filter((line) => line !== '')

  return said.length === 0 ? 'Could not sign in. Please try again.' : said.join(' ')
}

/**
 * What the dark panel says.
 *
 * Facts about the framework rather than numbers about this deployment: nothing is known
 * about the workspace before somebody is signed in, and a login screen that reports
 * "12 480 entries" to a stranger has answered a question nobody was allowed to ask.
 */
const FACTS = [
  { label: 'Mutations', value: 'One path' },
  { label: 'Schema', value: 'One source' },
  { label: 'Clients', value: 'Four' },
] as const

export const Login = () => {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure(undefined)
    setBusy(true)

    try {
      await signIn({ email, password })
    } catch (error) {
      setFailure(signInFailure(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh gap-2 bg-canvas p-2">
      <section className="flex flex-[1_1_46%] items-center justify-center rounded-2xl bg-surface px-14">
        <div className="w-full max-w-[336px] py-10">
          <div className="flex items-center gap-2.5 text-ink">
            <Logo size={24} />
            <span className="text-section font-[650] tracking-[-0.02em]">assemora</span>
            <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-xs text-ink-subdued">
              Studio
            </span>
          </div>

          <h1 className="mt-7 text-title font-[650] tracking-[-0.01em]">Sign in to Studio</h1>
          <p className="mt-2 text-base text-ink-soft">
            Editors, reviewers and owners use the same door.
          </p>

          {failure !== undefined && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2.5 text-danger-ink"
              style={{ animation: 'shake 0.24s ease-out' }}
            >
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span className="text-base">{failure}</span>
            </div>
          )}

          <form className="mt-[22px] flex flex-col gap-3.5" onSubmit={submit}>
            <label className="block text-base font-semibold">
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="you@studio.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="ring-field mt-1.5 block h-9 w-full rounded-lg border border-line bg-surface px-3 text-base font-normal hover:border-line-strong"
              />
            </label>

            <label className="block text-base font-semibold">
              Password
              <span className="relative mt-1.5 block">
                <input
                  type={reveal ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="ring-field block h-9 w-full rounded-lg border border-line bg-surface pr-10 pl-3 text-base font-normal hover:border-line-strong"
                />
                <button
                  type="button"
                  aria-label={reveal ? 'Hide the password' : 'Show the password'}
                  onClick={() => setReveal((shown) => !shown)}
                  className="absolute top-[5px] right-[5px] grid size-[26px] place-items-center rounded-[7px] text-ink-subdued hover:bg-surface-raised hover:text-ink-strong"
                >
                  {reveal ? (
                    <EyeOff aria-hidden className="size-4" />
                  ) : (
                    <Eye aria-hidden className="size-4" />
                  )}
                </button>
              </span>
            </label>

            <Button type="submit" size="lg" className="mt-1 w-full" busy={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-sm text-ink-subdued">
            Trouble signing in? A workspace owner can re-send your invite.
          </p>
        </div>
      </section>

      <aside className="hidden flex-[1_1_54%] rounded-2xl bg-chrome p-10 lg:block">
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-[7px] rounded-full bg-accent" />
            <span className="font-mono text-xs tracking-[0.06em] text-ink-faint">
              ASSEMORA STUDIO
            </span>
          </div>

          <div className="mt-auto">
            <p className="max-w-[22ch] text-[34px] leading-[1.1] font-[650] tracking-[-0.025em] text-chrome-ink">
              The content layer your build already trusts.
            </p>
            <p className="mt-[18px] max-w-[46ch] text-md leading-[1.55] text-ink-faint">
              One declaration produces the editor, the API and the types. Nothing drifts, because
              nothing is written twice.
            </p>
          </div>

          <dl className="mt-10 grid grid-cols-3 gap-5 border-t border-white/10 pt-6">
            {FACTS.map((fact) => (
              <div key={fact.label}>
                <dt className="text-sm text-ink-faint">{fact.label}</dt>
                <dd className="mt-1 text-[17px] font-[650] tracking-[-0.01em] text-chrome-ink tabular-nums">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  )
}
