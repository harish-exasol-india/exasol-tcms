import { type FormEvent, useState } from 'react';
import { ApiError } from '../lib/api.js';
import { useSignIn } from '../lib/auth.js';

export function SignIn() {
  const signIn = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    signIn.mutate({ email, password });
  }

  const message =
    signIn.error instanceof ApiError
      ? // The backend deliberately does not distinguish unknown account from wrong
        // password; the UI must not invent a distinction either.
        signIn.error.status === 401
        ? 'Invalid email or password.'
        : signIn.error.body.error
      : signIn.error
        ? 'Sign-in failed.'
        : null;

  return (
    <div className="centered">
      <form className="card form" onSubmit={submit}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Exasol TCMS</h1>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message ? <p className="error">{message}</p> : null}
        <button type="submit" disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
