import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, RefreshCw } from 'lucide-react';
import api, { getApiError } from '../api';
import './CompanyRegistration.css';

const stepInfo = {
  profile: ['Confirm company profile', null], warehouse: ['Create the first warehouse', 'Warehouses'],
  locations: ['Configure location hierarchy', 'Locations'], products: ['Add products and categories', 'Products'],
  suppliers: ['Add suppliers', 'Suppliers'], team: ['Add employees and memberships', 'Team'], roles: ['Review roles and permissions', null]
};
function CompanyOnboarding({ companyId, onOpenPage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({ currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' });
  const [savingPreferences, setSavingPreferences] = useState(false);
  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError('');
    try { const response = await api.get(`/companies/${companyId}/onboarding`); setData(response.data.data); setPreferences(response.data.data.settings || { currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' }); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => {
    let active = true;
    if (!companyId) return undefined;
    api.get(`/companies/${companyId}/onboarding`)
      .then((response) => { if (active) { setData(response.data.data); setPreferences(response.data.data.settings || { currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' }); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId]);
  const mark = async (step, action) => {
    setError('');
    try { await api.patch(`/companies/${companyId}/onboarding`, { step, action }); await load(); }
    catch (requestError) { setError(getApiError(requestError)); }
  };
  const savePreferences = async (event) => {
    event.preventDefault(); setSavingPreferences(true); setError('');
    try { await api.patch(`/companies/${companyId}/settings`, preferences); await load(); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setSavingPreferences(false); }
  };
  if (loading && !data) return <section className="company-onboarding"><p>Loading setup checklist…</p></section>;
  if (error && !data) return <section className="company-onboarding"><p role="alert">{error}</p><button type="button" onClick={load}>Retry</button></section>;
  if (!data || data.complete) return null;
  const percent = Math.round(data.completedCount / data.totalSteps * 100);
  return <section className="company-onboarding">
    <div className="company-onboarding-heading"><div><p className="registration-eyebrow">GET STARTED</p><h2>Set up {data.companyName}</h2><p>Use real company records; estimates from registration did not create operational data.</p></div><button type="button" className="registration-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    <details className="company-preferences"><summary>Company preferences</summary><form onSubmit={savePreferences}>
      <label>Currency (three-letter code)<input required maxLength={3} minLength={3} pattern="[A-Za-z]{3}" value={preferences.currency} onChange={(event) => setPreferences({ ...preferences, currency: event.target.value.toUpperCase() })} /></label>
      <label>Time zone<input required maxLength={80} value={preferences.timeZone} onChange={(event) => setPreferences({ ...preferences, timeZone: event.target.value })} /></label>
      <label>Measurement units<select value={preferences.measurementUnits} onChange={(event) => setPreferences({ ...preferences, measurementUnits: event.target.value })}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
      <button type="submit" className="registration-primary" disabled={savingPreferences}>{savingPreferences ? 'Saving…' : 'Save preferences'}</button>
    </form></details>
    <div className="onboarding-progress"><span style={{ width: `${percent}%` }} /></div><small>{percent}% complete · {data.completedCount} of {data.totalSteps} steps</small>
    {error && <p className="registration-error" role="alert">{error}</p>}
    <div className="onboarding-steps">{data.steps.map((step) => {
      const [label, page] = stepInfo[step.id] || [step.id, null];
      return <article key={step.id} className={step.completed ? 'done' : ''}><span className="onboarding-check">{step.completed ? <Check size={16} /> : '•'}</span><div><strong>{label}</strong><small>{step.completed ? 'Complete' : step.skipped ? 'Skipped · you can return later' : step.count != null ? `${step.count} configured` : 'Review and confirm'}</small></div>{page && <button type="button" onClick={() => onOpenPage(page)}>Open <ArrowRight size={14} /></button>}{!step.completed && !step.skipped && !['warehouse', 'profile', 'roles'].includes(step.id) && <button type="button" className="onboarding-muted" onClick={() => mark(step.id, 'skip')}>Skip for now</button>}{['profile', 'roles'].includes(step.id) && !step.completed && <button type="button" onClick={() => mark(step.id, 'complete')}>{step.id === 'roles' ? 'Confirm review' : 'Confirm'}</button>}</article>;
    })}</div>
    <p className="registration-hint">Optional items can be skipped and completed later. Warehouse setup is required before this checklist can be completed.</p>
  </section>;
}
export default CompanyOnboarding;
