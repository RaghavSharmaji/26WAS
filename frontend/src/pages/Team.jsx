import { useEffect, useMemo, useState } from 'react';
import { Save, Users } from 'lucide-react';
import api, { getApiError } from '../api';

export default function Team({ companyId, permissionCatalog = [] }) {
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = members.find((member) => member.user?.id === selectedId) || null;
  const permissions = useMemo(() => [...new Set(permissionCatalog)].sort(), [permissionCatalog]);

  const loadMembers = async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/companies/${companyId}/members`);
      const rows = data.data || [];
      setMembers(rows);
      setSelectedId((current) => rows.some((member) => member.user?.id === current) ? current : '');
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMembers(); }, [companyId]);

  useEffect(() => {
    if (!selected) {
      setDraft({});
      return;
    }
    setDraft(Object.fromEntries((selected.permissionOverrides || []).map((row) => [row.permission, row.effect])));
    setReason('');
  }, [selectedId, members]);

  const saveOverrides = async (event) => {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    const permissionOverrides = Object.entries(draft)
      .filter(([, effect]) => effect === 'allow' || effect === 'deny')
      .map(([permission, effect]) => ({ permission, effect }));
    try {
      const { data } = await api.patch(`/companies/${companyId}/members/${selected.user.id}/permissions`, {
        expectedRevision: selected.revision,
        reason: reason.trim(),
        permissionOverrides,
      });
      setMembers((current) => current.map((member) => member.user?.id === selected.user.id ? data.data : member));
      setNotice('Permission overrides saved and audited.');
      setReason('');
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="team-page">
      <div className="page-heading">
        <div><h1>Employees and roles</h1><p>Review active company memberships and set explicit permission overrides.</p></div>
      </div>
      {error && <div className="data-error" role="alert">{error}</div>}
      {notice && <div className="data-success" role="status">{notice}</div>}
      {loading ? <div className="panel">Loading company members…</div> : (
        <div className="panel team-panel">
          <h3><Users size={18} /> Company members</h3>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>STATUS</th><th>WAREHOUSE ASSIGNMENTS</th><th>PERMISSIONS</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user?.id || member.id}>
                    <td><strong>{member.user?.name || member.user?.email || 'Unavailable account'}</strong><small>{member.user?.email || member.user?.id}</small></td>
                    <td>{member.role.replaceAll('_', ' ')}</td>
                    <td>{member.status}</td>
                    <td>{member.assignedWarehouseIds?.length ? member.assignedWarehouseIds.length : 'Company-wide'}</td>
                    <td><button type="button" className="text-btn" disabled={!member.user?.id || member.status !== 'active'} onClick={() => setSelectedId(member.user.id)}>Configure</button></td>
                  </tr>
                ))}
                {!members.length && <tr><td colSpan="5" className="data-empty">No company members found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <div className="panel team-permission-editor">
        <div><h3>Permission overrides: {selected.user?.name || selected.user?.email}</h3><p>Role defaults apply unless a permission is explicitly allowed or denied. Deny overrides always take precedence.</p></div>
        <form onSubmit={saveOverrides}>
          <div className="team-permission-grid">
            {permissions.map((permission) => (
              <label key={permission}>
                <span>{permission}</span>
                <select value={draft[permission] || ''} onChange={(event) => setDraft((current) => ({ ...current, [permission]: event.target.value }))}>
                  <option value="">Use role default</option>
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </select>
              </label>
            ))}
          </div>
          <label className="team-reason">Reason for this change<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this employee needs different access" /></label>
          <div className="modal-actions"><button type="button" className="cancel-btn" onClick={() => setSelectedId('')}>Cancel</button><button type="submit" className="primary-btn" disabled={saving || !reason.trim()}><Save size={16} />{saving ? 'Saving…' : 'Save permissions'}</button></div>
        </form>
      </div>}
    </section>
  );
}
