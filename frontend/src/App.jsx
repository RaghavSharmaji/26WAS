import SettingsPage from "./pages/Settings";
import OtherPages from "./pages/OtherPages";
import Orders from "./pages/Orders";
import { useEffect, useState } from "react";
import Inventory from "./pages/Inventory";
import Products from "./pages/Products";
import AuthPage from "./pages/AuthPage";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import PasswordChange from "./pages/PasswordChange";
import Team from "./pages/Team";
import Receiving from "./pages/Receiving";
import PurchaseOrders from "./pages/PurchaseOrders";
import api from "./api";
import CompanyRegistration from "./pages/CompanyRegistration";
import RegistrationStatus from "./pages/RegistrationStatus";
import CompanyOnboarding from "./pages/CompanyOnboarding";
import LegalDraft from "./pages/LegalDraft";

import {
  LayoutDashboard,
  Package,
  Boxes,
  Truck,
  Warehouse,
  MapPin,
  Tags,
  Users,
  BarChart3,
  Settings,
  Bell,
  Search,
  Plus,
  ArrowDownRight,
  Menu,
  ClipboardPlus,
  ClipboardList,
} from "lucide-react";

import "./App.css";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { name: "Team", icon: Users, permission: "users.manage" },
  { name: "Products", icon: Package, permission: "products.view" },
  { name: "Inventory", icon: Boxes, permission: "inventory.view" },
  { name: "Purchase Orders", icon: ClipboardList, permission: "purchaseOrders.view" },
  { name: "Receiving", icon: ClipboardPlus, permission: "receiving.view" },
  { name: "Orders", icon: Truck, permission: "orders.view" },
  { name: "Categories", icon: Tags, permission: "categories.view" },
  { name: "Suppliers", icon: Users, permission: "suppliers.view" },
  { name: "Warehouses", icon: Warehouse, permission: "warehouses.view" },
  { name: "Locations", icon: MapPin, permission: "locations.view" },
  { name: "Reports", icon: BarChart3, permission: "reports.view" },
];

const isSuperAdmin = (role) => role === "super_admin" || role === "superadmin";

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [browserPath, setBrowserPath] = useState(window.location.pathname);
  const [globalSearch, setGlobalSearch] = useState("");
  const [inventorySearchTerm, setInventorySearchTerm] = useState("");
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [dashboardProducts, setDashboardProducts] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [dashboardOperational, setDashboardOperational] = useState({ pendingPutaway: null, openOrders: null, supplierCount: null });
  const [companies, setCompanies] = useState([]);
  const [activeCompanyId, setActiveCompanyId] = useState(localStorage.getItem("wms.activeCompanyId") || "");
  const [warehouses, setWarehouses] = useState([]);
  const [activeWarehouseId, setActiveWarehouseId] = useState(localStorage.getItem("wms.activeWarehouseId") || "");
  const [companyContextReady, setCompanyContextReady] = useState(false);
  const [companyContextError, setCompanyContextError] = useState("");
  const [companyContextAttempt, setCompanyContextAttempt] = useState(0);
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const activeCompany = companies.find((company) => company.id === activeCompanyId);
  const effectivePermissions = activeCompany?.permissions || [];
  const visibleMenuItems = menuItems.filter((item) => effectivePermissions.includes(item.permission));

  useEffect(() => {
    const onPopState = () => setBrowserPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigatePath = (path) => {
    window.history.pushState({}, '', path);
    setBrowserPath(path);
  };

  useEffect(() => {
    if (activePage !== "Dashboard" && !visibleMenuItems.some((item) => item.name === activePage)) {
      setActivePage("Dashboard");
    }
  }, [activePage, activeCompanyId, companies]);

  useEffect(() => {
    const token = localStorage.getItem("wms.auth.token");
    if (!token) {
      setAuthReady(true);
      return;
    }
    api.get("/auth/user")
      .then(({ data }) => setSession({ token, user: data.user }))
      .catch((error) => {
        localStorage.removeItem("wms.auth.token");
        localStorage.removeItem("wms.auth.user");
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!session || isSuperAdmin(session.user.role)) {
      setCompanies([]);
      setCompanyContextReady(true);
      return;
    }
    let cancelled = false;
    setCompanyContextReady(false);
    setCompanyContextError("");
    api.get("/companies/mine")
      .then(async ({ data }) => {
        if (cancelled) return;
        const rows = data.data || [];
        const activeRows = rows.filter((company) => company.status === 'active');
        if (activeRows.length === 0 && rows.some((company) => company.registration?.reference)) {
          localStorage.removeItem("wms.activeCompanyId");
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveCompanyId(""); setActiveWarehouseId(""); setCompanies([]);
          window.history.replaceState({}, '', '/registration/status');
          setBrowserPath('/registration/status');
          return;
        }
        if (activeRows.length === 0 && rows.length > 0) {
          setCompanies(rows);
          setCompanyContextError(rows[0].status === 'pending'
            ? 'Your company is awaiting activation by a platform administrator.'
            : 'Your company is suspended or unavailable.');
          setCompanyContextReady(true);
          return;
        }
        setCompanies(activeRows);
        const stored = localStorage.getItem("wms.activeCompanyId");
        const selected = activeRows.find((company) => company.id === stored);
        if (selected) {
          await api.post(`/companies/${selected.id}/select`);
          if (cancelled) return;
          setActiveCompanyId(selected.id);
        } else if (activeRows.length === 1) {
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveWarehouseId("");
          await api.post(`/companies/${activeRows[0].id}/select`);
          if (cancelled) return;
          localStorage.setItem("wms.activeCompanyId", activeRows[0].id);
          setActiveCompanyId(activeRows[0].id);
        } else {
          localStorage.removeItem("wms.activeCompanyId");
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveCompanyId("");
          setActiveWarehouseId("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          localStorage.removeItem("wms.activeCompanyId");
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveCompanyId("");
          setActiveWarehouseId("");
          setCompanyContextError(error?.response?.data?.message || (
            error?.code === "ERR_NETWORK"
              ? "Could not reach the WMS API. Check that the backend is running and your connection is available."
              : "Could not verify your company access. Review the error and reload."
          ));
        }
      })
      .finally(() => {
        if (!cancelled) setCompanyContextReady(true);
      });
    return () => { cancelled = true; };
  }, [session, companyContextAttempt]);

  useEffect(() => {
    if (!activeCompanyId || isSuperAdmin(session?.user.role)) {
      setWarehouses([]);
      return;
    }
    let cancelled = false;
    api.get("/warehouses")
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data.data || [];
        setWarehouses(rows);
        const stored = localStorage.getItem("wms.activeWarehouseId");
        const selected = rows.find((warehouse) => String(warehouse._id) === stored);
        if (selected) setActiveWarehouseId(String(selected._id));
        else if (rows.length === 1) {
          const id = String(rows[0]._id);
          localStorage.setItem("wms.activeWarehouseId", id);
          setActiveWarehouseId(id);
        } else {
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveWarehouseId("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWarehouses([]);
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveWarehouseId("");
        }
      });
    return () => { cancelled = true; };
  }, [activeCompanyId, session]);

  useEffect(() => {
    if (!session || !companyContextReady || (companies.length > 1 && !activeCompanyId)) return;
    let cancelled = false;
    Promise.all([
      api.get("/products"), api.get("/inventory"), api.get("/reports/summary"),
      api.get("/pallets").catch(() => null), api.get("/order").catch(() => null), api.get("/suppliers").catch(() => null)
    ])
      .then(([productsResponse, inventoryResponse, summaryResponse, palletsResponse, ordersResponse, suppliersResponse]) => {
        if (cancelled) return;
        const inventoryBySku = new Map(inventoryResponse.data.data.map((row) => [row._id, row.availableQuantity]));
        setDashboardProducts(productsResponse.data.data.map((item) => {
          const stock = inventoryBySku.get(item.skuNumber) || 0;
          const reorderLevel = Number(item.reorderLevel || 0);
          return {
            id: item.skuNumber,
            name: item.name,
            category: item.department,
            skuNumber: item.skuNumber,
            stock,
            price: Number(item.price || 0),
            reorderLevel,
            status: stock === 0 ? "Out of Stock" : stock <= reorderLevel && reorderLevel > 0 ? "Low Stock" : "In Stock",
          };
        }));
        setDashboardSummary(summaryResponse.data.data);
        const pallets = palletsResponse?.data?.data;
        const orders = ordersResponse?.data?.data;
        const suppliers = suppliersResponse?.data?.data;
        setDashboardOperational({
          pendingPutaway: Array.isArray(pallets) ? pallets.filter((pallet) => pallet.status === "received").length : null,
          openOrders: Array.isArray(orders) ? orders.filter((order) => !["delivered", "cancelled"].includes(String(order.status || "").toLowerCase())).length : null,
          supplierCount: Array.isArray(suppliers) ? suppliers.length : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDashboardProducts([]);
        setDashboardSummary(null);
        setDashboardOperational({ pendingPutaway: null, openOrders: null, supplierCount: null });
      });
    return () => { cancelled = true; };
  }, [session, companyContextReady, companies.length, activeCompanyId, activeWarehouseId]);

  const handleCompanySelect = async (companyId) => {
    setCompanyContextError("");
    try {
      await api.post(`/companies/${companyId}/select`);
      localStorage.setItem("wms.activeCompanyId", companyId);
      localStorage.removeItem("wms.activeWarehouseId");
      setActiveCompanyId(companyId);
      setActiveWarehouseId("");
      setWarehouses([]);
      setDashboardProducts([]);
      setDashboardSummary(null);
    } catch (error) {
      localStorage.removeItem("wms.activeCompanyId");
      localStorage.removeItem("wms.activeWarehouseId");
      setActiveCompanyId("");
      setActiveWarehouseId("");
      setWarehouses([]);
      setDashboardProducts([]);
      setDashboardSummary(null);
      setCompanyContextError(error.response?.data?.message || "Could not select that company.");
    }
  };

  const handleAuthenticated = (payload) => {
    localStorage.setItem("wms.auth.token", payload.token);
    localStorage.setItem("wms.auth.user", JSON.stringify(payload.user));
    setSession({ token: payload.token, user: payload.user });
  };

  const handleLogout = () => {
    localStorage.removeItem("wms.auth.token");
    localStorage.removeItem("wms.auth.user");
    localStorage.removeItem("wms.activeCompanyId");
    localStorage.removeItem("wms.activeWarehouseId");
    setSession(null);
    setDashboardProducts([]);
    setDashboardSummary(null);
  };

  const handleSessionUpdated = (updatedSession) => {
    localStorage.setItem("wms.auth.user", JSON.stringify(updatedSession.user));
    setSession(updatedSession);
  };

  const handleWarehouseSelect = (warehouseId) => {
    if (warehouseId) localStorage.setItem("wms.activeWarehouseId", warehouseId);
    else localStorage.removeItem("wms.activeWarehouseId");
    setActiveWarehouseId(warehouseId);
    setDashboardProducts([]);
    setDashboardSummary(null);
  };

  const handleCreateCompany = async (event) => {
    event.preventDefault();
    const name = newCompanyName.trim();
    if (name.length < 2) return setCompanyContextError("Company name must contain at least two characters.");
    setCreatingCompany(true);
    setCompanyContextError("");
    try {
      const { data } = await api.post("/companies", { name });
      const created = data.data;
      await api.post(`/companies/${created.id}/select`);
      localStorage.setItem("wms.activeCompanyId", created.id);
      localStorage.removeItem("wms.activeWarehouseId");
      setCompanies((current) => [...current, created]);
      setActiveCompanyId(created.id);
      setActiveWarehouseId("");
      setNewCompanyName("");
      setShowCreateCompany(false);
    } catch (error) {
      setCompanyContextError(error.response?.data?.message || "Could not create the company.");
    } finally {
      setCreatingCompany(false);
    }
  };

  if (!authReady) return <div className="auth-loading">Checking your session…</div>;
  if (browserPath === '/register/company') return <CompanyRegistration onNavigate={navigatePath} />;
  if (browserPath === '/legal/terms-draft') return <LegalDraft type="terms" onBack={() => navigatePath('/register/company')} />;
  if (browserPath === '/legal/privacy-draft') return <LegalDraft type="privacy" onBack={() => navigatePath('/register/company')} />;
  if (!session) return <AuthPage onAuthenticated={handleAuthenticated} onNavigateCompanyRegistration={() => navigatePath('/register/company')} />;
  if (browserPath === '/registration/status') return <RegistrationStatus onLogout={handleLogout} />;
  if (session.user.mustChangePassword) {
    return <PasswordChange session={session} onUpdated={handleSessionUpdated} onLogout={handleLogout} />;
  }
  if (isSuperAdmin(session.user.role)) {
    return <SuperAdminDashboard user={session.user} onLogout={handleLogout} />;
  }
  if (!companyContextReady) return <div className="auth-loading">Loading your company access…</div>;
  if (companyContextError && companies.length <= 1) {
    return (
      <main className="company-select-page">
        <section className="company-select-card">
          <h1>Company access needs attention</h1>
          <p>{companyContextError}</p>
          <button type="button" className="company-create-btn" onClick={() => {
            setCompanyContextError("");
            setCompanyContextAttempt((attempt) => attempt + 1);
          }}>Try again</button>
          <button type="button" className="logout-btn" onClick={handleLogout}>Log out</button>
        </section>
      </main>
    );
  }
  if (companies.length > 1 && !activeCompanyId) {
    return (
      <main className="company-select-page">
        <section className="company-select-card">
          <div className="brand-icon"><Warehouse size={25} /></div>
          <h1>Select a company</h1>
          <p>Choose the company workspace you are authorized to use.</p>
          {companyContextError && <p className="data-error">{companyContextError}</p>}
          <div className="company-select-list">
            {companies.map((company) => (
              <button type="button" key={company.id} onClick={() => handleCompanySelect(company.id)}>
                <strong>{company.name}</strong><span>{company.slug} · {company.role.replaceAll("_", " ")}</span>
              </button>
            ))}
          </div>
          <button type="button" className="logout-btn" onClick={handleLogout}>Log out</button>
        </section>
      </main>
    );
  }

  const globalResults = dashboardProducts.filter((product) => {
    const query = globalSearch.trim().toLowerCase();

    if (!query) return false;

    return (
      product.name.toLowerCase().includes(query) ||
      product.skuNumber.toLowerCase().includes(query) ||
      product.category.toLowerCase().includes(query)
    );
  });

  const currentRole = activeCompany?.role || "warehouse_staff";
  const productCount = dashboardSummary?.productCount;
  const stockValue = dashboardSummary?.totalAvailableQuantity;
  const lowStockCount = dashboardProducts.filter((product) => product.reorderLevel > 0 && product.stock <= product.reorderLevel).length;
  const metric = (title, value, note, icon, color) => ({ title, value: value == null ? "Unavailable" : String(value), change: note, up: true, icon, color });
  const roleDashboardStats = {
    company_admin: [
      metric("Warehouses", dashboardSummary?.warehouseCount, "In this company", Warehouse, "blue"),
      metric("Products", productCount, "Company catalog", Package, "purple"),
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Across authorized warehouses", Boxes, "green"),
      metric("Low Stock Products", lowStockCount, "At or below reorder level", Bell, "orange"),
    ],
    warehouse_manager: [
      metric("Pallets Awaiting Putaway", dashboardOperational.pendingPutaway, "Received pallets", ClipboardPlus, "orange"),
      metric("Open Orders", dashboardOperational.openOrders, "Orders not marked delivered", Truck, "purple"),
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Assigned warehouses", Boxes, "green"),
      metric("Products", productCount, "Company catalog", Package, "blue"),
    ],
    inventory_manager: [
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Assigned warehouses", Boxes, "green"),
      metric("Low Stock Products", lowStockCount, "At or below reorder level", Bell, "orange"),
      metric("Products", productCount, "Company catalog", Package, "blue"),
      metric("Locations", dashboardSummary?.locationCount, "Company locations", MapPin, "purple"),
    ],
    procurement_manager: [
      metric("Suppliers", dashboardOperational.supplierCount, "Company supplier records", Users, "blue"),
      metric("Pallets Awaiting Putaway", dashboardOperational.pendingPutaway, "Received pallets", ClipboardPlus, "orange"),
      metric("Products", productCount, "Company catalog", Package, "purple"),
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Across authorized warehouses", Boxes, "green"),
    ],
    warehouse_staff: [
      metric("Pallets Awaiting Putaway", dashboardOperational.pendingPutaway, "Received pallets", ClipboardPlus, "orange"),
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Assigned warehouses", Boxes, "green"),
      metric("Products", productCount, "Company catalog", Package, "blue"),
      metric("Assigned Warehouses", warehouses.length, "Your active assignments", Warehouse, "purple"),
    ],
    auditor: [
      metric("Available Units", stockValue?.toLocaleString("en-IN"), "Authorized warehouse scope", Boxes, "green"),
      metric("Open Orders", dashboardOperational.openOrders, "Orders not marked delivered", Truck, "purple"),
      metric("Products", productCount, "Company catalog", Package, "blue"),
      metric("Low Stock Products", lowStockCount, "At or below reorder level", Bell, "orange"),
    ],
  };
  const stats = roleDashboardStats[currentRole] || roleDashboardStats.warehouse_staff;

  const openInventoryProduct = (product) => {
    setInventorySearchTerm(product.name);
    setGlobalSearch("");
    setActivePage("Inventory");
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Warehouse size={25} />
          </div>

          <div>
            <h2>WareFlow</h2>
            <span>WAREHOUSE SYSTEM</span>
          </div>
        </div>

        <div className="menu-label">MAIN MENU</div>

        <nav className="navigation">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.name}
                className={`nav-item ${activePage === item.name ? "active" : ""
                  }`}
                onClick={() => setActivePage(item.name)}
              >
                <Icon size={19} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          {effectivePermissions.includes("company.settings.view") && <button
            className={`nav-item ${activePage === "Settings" ? "active" : ""
              }`}
            onClick={() => setActivePage("Settings")}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>}

          <div className="profile">
            <div className="avatar">{session.user.name.slice(0, 2).toUpperCase()}</div>

            <div>
              <strong>{session.user.name}</strong>
                <span>{activeCompany?.role?.replaceAll("_", " ") || session.user.role}</span>
            </div>
            <button className="logout-btn" type="button" onClick={handleLogout}>Log out</button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        {/* TOP HEADER */}
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu">
              <Menu />
            </button>

            <div>
              <h3>{activePage}</h3>
              <p>Welcome back! Here's what's happening today.</p>
            </div>
          </div>

          <div className="topbar-right">
            {companies.length === 0 && (
              <button className="company-create-btn" type="button" onClick={() => setShowCreateCompany(true)}>Create company</button>
            )}
            {companies.length > 0 && (
              <label className="company-switcher">
                <span>Company</span>
                <select value={activeCompanyId} onChange={(event) => handleCompanySelect(event.target.value)}>
                  {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
            )}
            {warehouses.length > 0 && (
              <label className="company-switcher">
                <span>Warehouse</span>
                <select value={activeWarehouseId} onChange={(event) => handleWarehouseSelect(event.target.value)}>
                  <option value="">All authorized warehouses</option>
                  {warehouses.map((warehouse) => <option key={warehouse._id} value={warehouse._id}>{warehouse.name}</option>)}
                </select>
              </label>
            )}
            {/* GLOBAL SEARCH */}
            <div className="search-box global-search">
              <Search size={17} />

              <input
                type="text"
                placeholder="Search products, SKU, category..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />

              {globalSearch.trim() && (
                <div className="global-search-results">
                  {globalResults.length > 0 ? (
                    globalResults.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        onClick={() => openInventoryProduct(product)}
                      >
                        <div>
                          <strong>{product.name}</strong>
                          <span>
                            {product.id} · {product.category}
                          </span>
                        </div>

                        <Search size={15} />
                      </button>
                    ))
                  ) : (
                    <p>No matching products found.</p>
                  )}
                </div>
              )}
            </div>

            <div className="top-avatar">{session.user.name.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>

        {showCreateCompany && (
          <div className="company-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreateCompany(false);
          }}>
            <form className="company-select-card company-create-form" onSubmit={handleCreateCompany}>
              <h1>Create your company</h1>
              <p>This creates a company workspace and makes you its Company Admin. Existing personal workspace records are not migrated automatically.</p>
              {companyContextError && <p className="data-error">{companyContextError}</p>}
              <label htmlFor="new-company-name">Company name</label>
              <input id="new-company-name" autoFocus maxLength={120} value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)} required />
              <div className="company-create-actions">
                <button type="button" className="logout-btn" onClick={() => setShowCreateCompany(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={creatingCompany}>{creatingCompany ? "Creating…" : "Create company"}</button>
              </div>
            </form>
          </div>
        )}

        {/* PAGE CONTENT */}
        {activePage === "Dashboard" ? (
          <section className="dashboard-body">
            {activeCompany?.role === 'company_admin' && <CompanyOnboarding companyId={activeCompanyId} onOpenPage={setActivePage} />}
            <div className="page-heading">
              <div>
                <h1>Overview</h1>
                <p>
                  Monitor your warehouse operations at a glance.
                </p>
              </div>

              {effectivePermissions.includes("products.create") && <button
                className="primary-btn"
                onClick={() => setActivePage("Products")}
              >
                <Plus size={18} />
                Add Product
              </button>}
            </div>

            {/* STATISTICS */}
            <div className="stats-grid">
              {stats.map((stat) => {
                const Icon = stat.icon;

                return (
                  <div className="stat-card" key={stat.title}>
                    <div className="stat-top">
                      <span>{stat.title}</span>

                      <div className={`stat-icon ${stat.color}`}>
                        <Icon size={21} />
                      </div>
                    </div>

                    <h2>{stat.value}</h2>

                    <div className="stat-change">{stat.change}</div>
                  </div>
                );
              })}
            </div>

            {/* INVENTORY AND ALERTS */}
            <div className="content-grid">
              <section className="panel inventory-panel">
                <div className="panel-header">
                  <div>
                    <h3>Product stock snapshot</h3>
                    <p>Current available units by product</p>
                  </div>

                  {effectivePermissions.includes("products.view") && <button
                    className="text-btn"
                    onClick={() => setActivePage("Products")}
                  >
                    View all
                  </button>}
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>PRODUCT</th>
                        <th>CATEGORY</th>
                        <th>STOCK</th>
                        <th>PRICE</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>

                    <tbody>
                      {dashboardProducts.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <strong>{product.name}</strong>
                            <small>{product.skuNumber}</small>
                          </td>

                          <td>{product.category}</td>
                          <td>{product.stock}</td>
                          <td>₹{product.price.toLocaleString("en-IN")}</td>

                          <td>
                            <span
                              className={`status ${product.status
                                .toLowerCase()
                                .replaceAll(" ", "-")}`}
                            >
                              {product.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* STOCK ALERTS */}
              <section className="panel alerts-panel">
                <div className="panel-header">
                  <div>
                    <h3>Stock Alerts</h3>
                    <p>Items requiring attention</p>
                  </div>

                  <Bell size={19} color="#e69a36" />
                </div>

                {dashboardProducts.filter((product) => product.reorderLevel > 0 && product.stock <= product.reorderLevel).slice(0, 3).map((product) => (
                  <div className="alert-item" key={product.id}>
                    <div className={`alert-dot ${product.stock === 0 ? "red-dot" : "orange-dot"}`}></div>
                    <div><strong>{product.name}</strong><p>{product.stock === 0 ? "Currently out of stock" : `Only ${product.stock} units remaining`}</p></div>
                    <span>{product.stock}</span>
                  </div>
                ))}
                {dashboardProducts.filter((product) => product.reorderLevel > 0 && product.stock <= product.reorderLevel).length === 0 && (
                  <div className="alert-item"><div><strong>No low stock alerts</strong><p>Items at or below their reorder level will appear here.</p></div></div>
                )}

                <button className="alert-button">
                  View all alerts
                </button>
              </section>
            </div>

            {/* RECENT ACTIVITY */}
            <section className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <h3>Recent Activity</h3>
                  <p>Latest warehouse operations</p>
                </div>
              </div>

              {(dashboardSummary?.recentMovements || []).slice(0, 5).map((movement) => (
                <div className="activity-row" key={movement._id}>
                  <div className={`activity-icon ${['stock-in', 'receipt'].includes(movement.type) ? "green" : ['stock-out', 'dispatch'].includes(movement.type) ? "blue" : "purple"}`}>
                    {['stock-in', 'receipt'].includes(movement.type) ? <ArrowDownRight size={19} /> : ['stock-out', 'dispatch'].includes(movement.type) ? <Truck size={19} /> : <Package size={19} />}
                  </div>
                  <div><strong>{{ 'stock-in': 'Stock added', receipt: 'Goods received', 'stock-out': 'Stock issued', dispatch: 'Order dispatched', quarantine: 'Goods quarantined', putaway: 'Goods put away', reserve: 'Stock reserved', pick: 'Stock picked', release: 'Stock released', adjustment: 'Stock adjusted' }[movement.type] || 'Inventory movement'}</strong><p>{movement.skuNumber} · {movement.quantity} units · {movement.reason}</p></div>
                  <time>{new Date(movement.createdAt).toLocaleString("en-IN")}</time>
                </div>
              ))}
              {(!dashboardSummary?.recentMovements || dashboardSummary.recentMovements.length === 0) && (
                <div className="activity-row"><div><strong>No inventory activity yet</strong><p>Stock movements will appear here after the first receiving or adjustment.</p></div></div>
              )}
            </section>

            <footer>
              © 2026 WareFlow. Warehouse Management System.
            </footer>
          </section>
        ) : activePage === "Team" ? (
          <Team key={`team:${activeCompanyId}`} companyId={activeCompanyId} permissionCatalog={effectivePermissions} />
        ) : activePage === "Products" ? (
          <Products key={`products:${activeCompanyId}:${activeWarehouseId}`} permissions={effectivePermissions} />
        ) : activePage === "Inventory" ? (
          <Inventory key={`inventory:${activeCompanyId}:${activeWarehouseId}`} searchTerm={inventorySearchTerm} permissions={effectivePermissions} warehouseId={activeWarehouseId} />
        ) : activePage === "Receiving" ? (
          <Receiving key={`receiving:${activeCompanyId}:${activeWarehouseId}`} permissions={effectivePermissions} />
        ) : activePage === "Purchase Orders" ? (
          <PurchaseOrders key={`purchase-orders:${activeCompanyId}:${activeWarehouseId}`} permissions={effectivePermissions} />
        ) : activePage === "Orders" ? (
          <Orders key={`orders:${activeCompanyId}:${activeWarehouseId}`} permissions={effectivePermissions} />
        ) : activePage === "Settings" ? (
          <SettingsPage key={`settings:${activeCompanyId}:${activeWarehouseId}`} user={session.user} />
        ) : (
          <OtherPages key={`${activePage}:${activeCompanyId}:${activeWarehouseId}`} activePage={activePage} permissions={effectivePermissions} />
        )}
      </main>
    </div>
  );
}

export default App;
