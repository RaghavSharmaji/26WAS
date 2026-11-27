import axios from 'axios';

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000'}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wms.auth.token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const companyId = localStorage.getItem('wms.activeCompanyId');
  if (companyId) config.headers['X-Company-Id'] = companyId;
  const warehouseId = localStorage.getItem('wms.activeWarehouseId');
  if (warehouseId) config.headers['X-Warehouse-Id'] = warehouseId;
  return config;
});

export function getApiError(error) {
  if (error.response?.data?.message) return error.response.data.message;
  if (error.code === 'ERR_NETWORK') return 'Could not reach the WMS API. Check that the backend is running.';
  return error.message || 'The request could not be completed.';
}

export default api;
