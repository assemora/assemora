/**
 * The login screen (SPEC.md §115).
 *
 * It sends credentials to `/auth/login` and nothing else. The command behind that
 * endpoint decides what a wrong password means, how long it takes to say so, and
 * what is written to the audit trail — none of which is Studio's business.
 */
import { type FormEvent, useState } from 'react'

import { ApiError, unshownMessages } from '../api/client.ts'
import { useSession } from '../api/session.tsx'
import { Button, Card, Field, Input } from '../ui/index.tsx'

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

export const Login = () => {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Assemora Studio</h1>
          <p className="text-sm text-ink-soft">Sign in to continue</p>
        </div>

        <Card className="p-6">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Email">
              <Input
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {failure !== undefined && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{failure}</p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  )
}
