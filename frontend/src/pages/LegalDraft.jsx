import { Warehouse } from 'lucide-react';
import './CompanyRegistration.css';

function LegalDraft({ type, onBack }) {
  const isTerms = type === 'terms';
  return <main className="company-registration-page"><article className="legal-draft">
    <div className="registration-brand"><span><Warehouse size={22} /></span><b>WareFlow</b></div>
    <p className="draft-banner">DRAFT FOR REVIEW — This document is not approved legal advice or a final contract.</p>
    <h1>{isTerms ? 'Draft Terms of Service' : 'Draft Privacy Notice'}</h1>
    {isTerms ? <><p>These draft terms describe the intended use of WareFlow during evaluation. They require legal review and acceptance by the service operator before commercial use.</p><h2>Account and workspace access</h2><p>Users must provide accurate registration details, protect their credentials, and use only workspaces for which they have authorization. Company activation is controlled by a platform administrator.</p><h2>Operational records</h2><p>Customers remain responsible for the accuracy of warehouse, inventory, order, and business records entered into the service.</p><h2>Availability and support</h2><p>This draft does not promise a service level, retention period, or support response time. Those terms must be agreed and documented before production deployment.</p></> : <><p>This draft explains the data categories currently collected by the WareFlow registration form. It requires review by the service operator and qualified counsel before commercial use.</p><h2>Information collected</h2><p>Registration collects business contact and address details, administrator name and work contact details, optional business identifiers, warehouse planning estimates, preference settings, and records of policy acceptance.</p><h2>Use and access</h2><p>Registration information is used to review the application and configure a tenant workspace. Sensitive business identifiers are restricted to authenticated Super Admin review endpoints. Applicants can see only their own application status.</p><h2>Verification and retention</h2><p>Email and government identifier verification services are not currently configured. A submitted identifier is not verified merely because it was supplied. Retention, deletion, and data-subject request procedures must be defined before production use.</p></>}
    <p>Document version: {isTerms ? 'wareflow-terms-draft-1' : 'wareflow-privacy-draft-1'}.</p>
    <button className="registration-primary" type="button" onClick={onBack}>Back to registration</button>
  </article></main>;
}
export default LegalDraft;
