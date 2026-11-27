import { useState } from 'react';
import { Eye, EyeOff, Warehouse } from 'lucide-react';
import api, { getApiError } from '../api';
import './CompanyRegistration.css';

const fields = {
  company: [
    ['legalName', 'Legal company name', 'text'], ['displayName', 'Company display name', 'text'],
    ['businessType', 'Business type', 'select', [['proprietorship', 'Proprietorship'], ['partnership', 'Partnership'], ['llp', 'Limited Liability Partnership (LLP)'], ['private_limited', 'Private Limited Company'], ['public_limited', 'Public Limited Company'], ['other', 'Other']]],
    ['industry', 'Industry', 'select', [['manufacturing', 'Manufacturing'], ['wholesale', 'Wholesale'], ['retail', 'Retail'], ['e-commerce', 'E-commerce'], ['logistics', 'Logistics'], ['distribution', 'Distribution'], ['pharmaceuticals', 'Pharmaceuticals'], ['food_beverage', 'Food and Beverage'], ['electronics', 'Electronics'], ['other', 'Other']]],
    ['email', 'Official business email', 'email'], ['phone', 'Business phone (include country code where possible)', 'tel'],
    ['country', 'Country', 'text'], ['state', 'State / Province', 'text'], ['city', 'City', 'text'],
    ['address', 'Complete registered address', 'textarea'], ['postalCode', 'Postal / PIN code', 'text'],
    ['website', 'Website (optional)', 'url', null, false], ['gstin', 'GSTIN (optional)', 'text', null, false],
    ['pan', 'PAN (optional)', 'text', null, false], ['cin', 'CIN / LLPIN (optional)', 'text', null, false],
    ['businessRegistrationNumber', 'Business registration number (optional)', 'text', null, false]
  ],
  administrator: [
    ['name', 'Full name', 'text'], ['designation', 'Designation', 'text'], ['email', 'Work email', 'email'],
    ['phone', 'Mobile number', 'tel'], ['password', 'Password', 'password'], ['confirmPassword', 'Confirm password', 'password']
  ],
  warehouseRequirements: [
    ['expectedWarehouses', 'Expected number of warehouses', 'number'], ['approximateSkus', 'Approximate SKUs / products', 'number'],
    ['monthlyOrders', 'Approximate monthly order volume', 'number'], ['employees', 'Approximate employees', 'number'],
    ['primaryWarehouseName', 'Primary warehouse name', 'text'],
    ['primaryWarehouseType', 'Primary warehouse type', 'select', [['distribution', 'Distribution'], ['fulfillment', 'Fulfillment'], ['cold_storage', 'Cold storage'], ['manufacturing', 'Manufacturing'], ['retail', 'Retail'], ['other', 'Other']]],
    ['primaryWarehouseAddress', 'Primary warehouse address', 'textarea'],
    ['currency', 'Preferred currency (ISO code)', 'text', null, false], ['timeZone', 'Preferred time zone', 'text', null, false],
    ['measurementUnits', 'Measurement units', 'select', [['metric', 'Metric'], ['imperial', 'Imperial']], false]
  ]
};
const initial = {
  company: { legalName: '', displayName: '', businessType: 'proprietorship', industry: 'retail', email: '', phone: '', country: 'India', state: '', city: '', address: '', postalCode: '', website: '', gstin: '', pan: '', cin: '', businessRegistrationNumber: '' },
  administrator: { name: '', designation: '', email: '', phone: '', password: '', confirmPassword: '' },
  warehouseRequirements: { expectedWarehouses: 1, approximateSkus: 0, monthlyOrders: 0, employees: 1, primaryWarehouseName: '', primaryWarehouseType: 'distribution', primaryWarehouseAddress: '', currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' }
};
const stepNames = ['Company information', 'Administrator', 'Warehouse requirements'];

function CompanyRegistration({ onNavigate }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initial);
  const [acceptance, setAcceptance] = useState({ terms: false, privacy: false, accuracy: false });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const group = ['company', 'administrator', 'warehouseRequirements'][step];
  const update = (key, value) => setForm((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  const move = (delta) => {
    setError('');
    if (delta > 0) {
      const missing = fields[group].some(([key, , type, , required = true]) => {
        const value = form[group][key];
        if (!required) return false;
        if (type === 'number') return !Number.isSafeInteger(Number(value)) || Number(value) < (key === 'expectedWarehouses' || key === 'employees' ? 1 : 0);
        return typeof value !== 'string' || value.trim().length < 2;
      });
      if (missing) return setError('Complete all required fields on this step before continuing.');
      if (['email'].some((key) => group === 'company' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.company[key].trim()))) return setError('Enter a valid company email address.');
      if (group === 'administrator' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.administrator.email.trim())) return setError('Enter a valid administrator email address.');
      if (group === 'administrator' && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}/.test(form.administrator.password)) return setError('Password must be 12–128 characters and include lower case, upper case, a number, and a symbol.');
    }
    if (delta > 0 && step === 1 && form.administrator.password !== form.administrator.confirmPassword) return setError('Password confirmation does not match.');
    setStep((current) => Math.max(0, Math.min(2, current + delta)));
  };
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/companies/register', { ...form, acceptance });
      setSubmitted(data.data);
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  };
  if (submitted) return <main className="company-registration-page"><section className="registration-card"><div className="registration-brand"><span><Warehouse size={22} /></span><b>WareFlow</b></div><p className="registration-eyebrow">APPLICATION RECEIVED</p><h1>Application submitted</h1><p>Your application for <strong>{submitted.companyName}</strong> is pending review.</p><p>Save this reference: <strong>{submitted.reference}</strong></p><button type="button" className="registration-primary" onClick={() => onNavigate('/')}>Continue to sign in</button></section></main>;
  return <main className="company-registration-page">
    <section className="registration-card">
      <div className="registration-brand"><span><Warehouse size={22} /></span><b>WareFlow</b></div>
      <p className="registration-eyebrow">COMPANY WORKSPACE APPLICATION</p>
      <h1>Register your company</h1>
      <p className="registration-intro">Submit your business details for review. Your workspace stays unavailable until a platform administrator activates it.</p>
      <div className="registration-progress" aria-label={`Step ${step + 1} of 3`}>{stepNames.map((label, index) => <div key={label} className={index <= step ? 'current' : ''}><span>{index + 1}</span><small>{label}</small></div>)}</div>
      <form onSubmit={submit}>
        <h2>{stepNames[step]}</h2>
        <div className="registration-fields">
          {fields[group].map(([key, label, type, options, required = true]) => {
            const value = form[group][key] ?? '';
            const inputType = key === 'password' && showPassword ? 'text' : type;
            return <label className={type === 'textarea' ? 'wide' : ''} key={key}>{label}{required && <span aria-hidden="true"> *</span>}
              {type === 'select' ? <select required={required} value={value} onChange={(event) => update(key, event.target.value)}>{options.map(([option, name]) => <option key={option} value={option}>{name}</option>)}</select>
                : type === 'textarea' ? <textarea required={required} maxLength={500} value={value} onChange={(event) => update(key, event.target.value)} />
                  : <span className="registration-input-wrap"><input required={required} type={inputType} min={type === 'number' ? (key === 'expectedWarehouses' || key === 'employees' ? 1 : 0) : undefined} max={type === 'number' ? 100000000 : undefined} step={type === 'number' ? 1 : undefined} minLength={key === 'password' ? 12 : key === 'legalName' || key === 'displayName' ? 2 : undefined} maxLength={key === 'password' || key === 'confirmPassword' ? 128 : 500} autoComplete={key === 'password' ? 'new-password' : undefined} value={value} onChange={(event) => {
                    const nextValue = type === 'number' ? Number(event.target.value) : event.target.value;
                    if (group === 'company' && key === 'country') {
                      const india = nextValue.trim().toLowerCase() === 'india';
                      setForm((current) => ({ ...current, company: { ...current.company, country: nextValue }, warehouseRequirements: { ...current.warehouseRequirements, currency: india ? 'INR' : 'USD', timeZone: india ? 'Asia/Kolkata' : 'UTC' } }));
                    } else update(key, nextValue);
                  }} />{key === 'password' && <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</span>}
            </label>;
          })}
        </div>
        {step === 1 && <p className="registration-hint">Use at least 12 characters with upper and lower case letters, a number, and a symbol.</p>}
        {step === 2 && <>
          <p className="registration-hint">These are planning estimates only. WareFlow will not create warehouses or inventory from these values. Defaults are metric units; Indian applicants default to INR and Asia/Kolkata.</p>
          <div className="registration-consents">
            <label><input type="checkbox" checked={acceptance.terms} onChange={(event) => setAcceptance({ ...acceptance, terms: event.target.checked })} required /> I accept the <a href="/legal/terms-draft" target="_blank" rel="noreferrer">draft Terms of Service</a>.</label>
            <label><input type="checkbox" checked={acceptance.privacy} onChange={(event) => setAcceptance({ ...acceptance, privacy: event.target.checked })} required /> I acknowledge the <a href="/legal/privacy-draft" target="_blank" rel="noreferrer">draft Privacy Notice</a>.</label>
            <label><input type="checkbox" checked={acceptance.accuracy} onChange={(event) => setAcceptance({ ...acceptance, accuracy: event.target.checked })} required /> I confirm the information submitted is accurate.</label>
          </div>
          <p className="registration-hint">No email or government identifier verification service is configured. Verification remains pending until reviewed.</p>
        </>}
        {error && <div className="registration-error" role="alert">{error}</div>}
        <div className="registration-actions"><button type="button" className="registration-secondary" onClick={() => step ? move(-1) : onNavigate('/')}>Back</button>{step < 2 ? <button type="button" className="registration-primary" onClick={() => move(1)}>Continue</button> : <button type="submit" className="registration-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>}</div>
      </form>
      <p className="registration-login">Already have an account? <button type="button" onClick={() => onNavigate('/')}>Log in</button></p>
    </section>
  </main>;
}

export default CompanyRegistration;
