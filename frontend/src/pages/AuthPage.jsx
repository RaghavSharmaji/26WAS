import { useState } from 'react';
import { Boxes, Eye, EyeOff, Warehouse } from 'lucide-react';
import api, { getApiError } from '../api';
import './AuthPage.css';

function AuthPage({ onAuthenticated, onNavigateCompanyRegistration }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isSignup = mode === 'signup';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/auth/${isSignup ? 'register' : 'login'}`, form);
      onAuthenticated(data);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand-icon"><Warehouse size={25} /></div>
        <p className="auth-eyebrow">WAREHOUSE MANAGEMENT</p>
        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-intro">{isSignup ? 'Sign up to get started with WareFlow.' : 'Sign in to manage your warehouse.'}</p>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" className={!isSignup ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
          <button type="button" className={isSignup ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Sign up</button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {isSignup && (
            <label>
              Name
              <input autoComplete="name" required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your name" />
            </label>
          )}
          <label>
            Email address
            <input type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" />
          </label>
          <label>
            Password
            <span className="auth-password-wrap">
              <input type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={isSignup ? 8 : undefined} maxLength={128} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={isSignup ? 'At least 8 characters' : 'Your password'} />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span>
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            <Boxes size={18} /> {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="auth-footer">{isSignup ? 'Already have an account?' : 'New to WareFlow?'}{' '}
          <button type="button" onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }}>{isSignup ? 'Log in' : 'Create an account'}</button>
        </p>
        {onNavigateCompanyRegistration && <p className="auth-footer">Register a business? <button type="button" onClick={onNavigateCompanyRegistration}>Apply for a company workspace</button></p>}
      </section>
    </main>
  );
}

export default AuthPage;
