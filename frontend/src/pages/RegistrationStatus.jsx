import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, LogOut, Warehouse } from 'lucide-react';
import api, { getApiError } from '../api';
import './CompanyRegistration.css';

function RegistrationStatus({ onLogout }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const { data } = await api.get('/companies/registration/status'); setRows(data.data || []); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    api.get('/companies/registration/status').then(({ data }) => { if (active) setRows(data.data || []); })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <main className="company-registration-page"><section className="registration-card status-card">
    <div className="registration-brand"><span><Warehouse size={22} /></span><b>WareFlow</b></div>
    <p className="registration-eyebrow">COMPANY APPLICATION</p><h1>Registration status</h1>
    <p className="registration-intro">Applications are reviewed by a platform administrator. Pending companies cannot access operational features.</p>
    <button className="registration-secondary" type="button" onClick={load} disabled={loading}><RefreshCw size={16} /> Refresh status</button>
    {error && <div className="registration-error" role="alert">{error}</div>}
    {loading ? <p className="registration-hint">Loading your applications…</p> : rows.length ? rows.map((row) => <article className="application-status" key={row.reference}>
      <strong>{row.companyName}</strong><span>Reference: {row.reference}</span><span>Submitted: {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : '—'}</span>
      <span>Application status: <b>{row.status.replaceAll('_', ' ')}</b></span><span>Workspace: <b>{row.companyStatus}</b></span><span>Email verification: {row.emailVerificationStatus || 'pending'}</span>
      {row.feedback && <p>Review feedback: {row.feedback}</p>}
      {row.status === 'rejected' && <p>Contact WareFlow support with your reference if you need clarification before submitting a new application.</p>}
      {row.status === 'verified' && row.companyStatus === 'pending' && <p>Your details were verified. A Super Admin still needs to activate your workspace.</p>}
      {row.companyStatus === 'active' && <p>Your workspace is active. Log out and sign in again to select it.</p>}
    </article>) : <p className="registration-hint">No application was found for this account. Sign in with the administrator email used during registration.</p>}
    <button type="button" className="registration-text-button" onClick={onLogout}><LogOut size={15} /> Log out</button>
  </section></main>;
}
export default RegistrationStatus;
