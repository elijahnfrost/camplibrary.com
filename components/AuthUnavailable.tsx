export function AuthUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <main className="auth-route">
      <div className="auth-route__brand">
        <img className="auth-route__logo" src="/logo-mark.svg" alt="" aria-hidden="true" />
        <span className="auth-route__kicker">Camp Library</span>
        <h1 className="auth-route__title">{title}</h1>
      </div>
      <div className="auth-form auth-form--prompt">
        <div className="auth-form__section">Staff access</div>
        <p className="auth-form__copy">{message}</p>
        <a className="btn btn--ghost btn--block" href="/">
          Back to browsing
        </a>
      </div>
    </main>
  );
}
