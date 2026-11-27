import { useState } from 'react';
import api, { getApiError } from '../api';
import './PasswordChange.css';

export default function PasswordChange({ session, onUpdated, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
      onUpdated({ ...session, user: data.user });
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return <main className="password-change-page"><form onSubmit={submit} className="password-change-card">
    <div className="password-change-mark">WF</div><p className="password-change-eyebrow">ACCOUNT SECURITY</p>
    <h1>Update your password</h1><p className="password-change-copy">An administrator issued a temporary password. Choose a new password to continue.</p>
    {error && <div className="password-change-error" role="alert">{error}</div>}
    <label>Temporary password<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
    <label>New password<input required type="password" minLength="12" maxLength="128" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>Use 12 to 128 characters.</small></label>
    <button disabled={saving}>{saving ? 'Updating…' : 'Update password'}</button>
    <button type="button" className="password-change-logout" onClick={onLogout}>Log out</button>
  </form></main>;
}
