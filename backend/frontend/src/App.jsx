import SettingsPage from "./pages/Settings";
import OtherPages from "./pages/OtherPages";
import Orders from "./pages/Orders";
import { useEffect, useState } from "react";
import Inventory from "./pages/Inventory";
import Products from "./pages/Products";
import AuthPage from "./pages/AuthPage";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import PasswordChange from "./pages/PasswordChange";
import api from "./api";

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
  ArrowUpRight,
  ArrowDownRight,
  Menu,
} from "lucide-react";

import "./App.css";

const menuItems = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Products", icon: Package },
  { name: "Inventory", icon: Boxes },
  { name: "Orders", icon: Truck },
  { name: "Categories", icon: Tags },
  { name: "Suppliers", icon: Users },
  { name: "Warehouses", icon: Warehouse },
  { name: "Locations", icon: MapPin },
  { name: "Reports", icon: BarChart3 },
];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [globalSearch, setGlobalSearch] = useState("");
  const [inventorySearchTerm, setInventorySearchTerm] = useState("");
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [dashboardProducts, setDashboardProducts] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [activeCompanyId, setActiveCompanyId] = useState(localStorage.getItem("wms.activeCompanyId") || "");
  const [warehouses, setWarehouses] = useState([]);
  const [activeWarehouseId, setActiveWarehouseId] = useState(localStorage.getItem("wms.activeWarehouseId") || "");
  const [companyContextReady, setCompanyContextReady] = useState(false);
  const [companyContextError, setCompanyContextError] = useState("");
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("wms.auth.token");
    if (!token) {
      setAuthReady(true);
      return;
    }
    api.get("/auth/user")
      .then(({ data }) => setSession({ token, user: data.user }))
      .catch(() => {
        localStorage.removeItem("wms.auth.token");
        localStorage.removeItem("wms.auth.user");
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!session || session.user.role === "superadmin") {
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
        setCompanies(rows);
        const stored = localStorage.getItem("wms.activeCompanyId");
        const selected = rows.find((company) => company.id === stored);
        if (selected) {
          await api.post(`/companies/${selected.id}/select`);
          if (cancelled) return;
          setActiveCompanyId(selected.id);
        } else if (rows.length === 1) {
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveWarehouseId("");
          await api.post(`/companies/${rows[0].id}/select`);
          if (cancelled) return;
          localStorage.setItem("wms.activeCompanyId", rows[0].id);
          setActiveCompanyId(rows[0].id);
        } else {
          localStorage.removeItem("wms.activeCompanyId");
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveCompanyId("");
          setActiveWarehouseId("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem("wms.activeCompanyId");
          localStorage.removeItem("wms.activeWarehouseId");
          setActiveCompanyId("");
          setActiveWarehouseId("");
          setCompanyContextError("Could not verify your company access. Check your connection, then reload.");
        }
      })
      .finally(() => {
        if (!cancelled) setCompanyContextReady(true);
      });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!activeCompanyId || session?.user.role === "superadmin") {
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
    Promise.all([api.get("/products"), api.get("/inventory"), api.get("/reports/summary")])
      .then(([productsResponse, inventoryResponse, summaryResponse]) => {
        const inventoryBySku = new Map(inventoryResponse.data.data.map((row) => [row._id, row.availableQuantity]));
        setDashboardProducts(productsResponse.data.data.map((item) => ({
          id: item.skuNumber,
          name: item.name,
          category: item.department,
          skuNumber: item.skuNumber,
          stock: inventoryBySku.get(item.skuNumber) || 0,
          price: Number(item.price || 0),
          reorderLevel: Number(item.reorderLevel || 0),
        })));
        setDashboardSummary(summaryResponse.data.data);
      })
      .catch(() => {
        setDashboardProducts([]);
        setDashboardSummary(null);
      });
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
      setActiveCompanyId("");
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
  if (!session) return <AuthPage onAuthenticated={handleAuthenticated} />;
  if (session.user.mustChangePassword) {
    return <PasswordChange session={session} onUpdated={handleSessionUpdated} onLogout={handleLogout} />;
  }
  if (session.user.role === "superadmin") {
    return <SuperAdminDashboard user={session.user} onLogout={handleLogout} />;
  }
  if (!companyContextReady) return <div className="auth-loading">Loading your company access…</div>;
  if (companyContextError && companies.length <= 1) {
    return (
      <main className="company-select-page">
        <section className="company-select-card">
          <h1>Company access needs attention</h1>
          <p>{companyContextError}</p>
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

  const stats = [
    {
      title: "Total Products",
      value: String(dashboardSummary?.productCount ?? dashboardProducts.length),
      change: "From database",
      up: true,
      icon: Package,
      color: "blue",
    },
    {
      title: "Total Stock Units",
      value: (dashboardSummary?.totalAvailableQuantity ?? 0).toLocaleString("en-IN"),
      change: "Available units",
      up: true,
      icon: Boxes,
      color: "green",
    },
    {
      title: "Active Orders",
      value: "—",
      change: "Orders summary unavailable",
      up: true,
      icon: Truck,
      color: "purple",
    },
    {
      title: "Low Stock Items",
      value: String(dashboardProducts.filter((product) => product.reorderLevel > 0 && product.stock <= product.reorderLevel).length),
      change: "Based on reorder levels",
      up: false,
      icon: Bell,
      color: "orange",
    },
  ];

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
          {menuItems.map((item) => {
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
          <button
            className={`nav-item ${activePage === "Settings" ? "active" : ""
              }`}
            onClick={() => setActivePage("Settings")}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="avatar">{session.user.name.slice(0, 2).toUpperCase()}</div>

            <div>
              <strong>{session.user.name}</strong>
              <span>{session.user.role === "admin" ? "Administrator" : "Staff"}</span>
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

            <button className="notification">
              <Bell size={20} />
              <span></span>
            </button>

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
            <div className="page-heading">
              <div>
                <h1>Overview</h1>
                <p>
                  Monitor your warehouse operations at a glance.
                </p>
              </div>

              <button
                className="primary-btn"
                onClick={() => setActivePage("Products")}
              >
                <Plus size={18} />
                Add Product
              </button>
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

                    <div
                      className={`stat-change ${stat.up ? "positive" : "negative"
                        }`}
                    >
                      {stat.up ? (
                        <ArrowUpRight size={16} />
                      ) : (
                        <ArrowDownRight size={16} />
                      )}

                      {stat.change}
                      <span> vs last month</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* INVENTORY AND ALERTS */}
            <div className="content-grid">
              <section className="panel inventory-panel">
                <div className="panel-header">
                  <div>
                    <h3>Recent Inventory</h3>
                    <p>Overview of your latest products</p>
                  </div>

                  <button
                    className="text-btn"
                    onClick={() => setActivePage("Products")}
                  >
                    View all
                  </button>
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
                  <div className={`activity-icon ${movement.type === "stock-in" ? "green" : movement.type === "stock-out" ? "blue" : "purple"}`}>
                    {movement.type === "stock-in" ? <ArrowDownRight size={19} /> : movement.type === "stock-out" ? <Truck size={19} /> : <Package size={19} />}
                  </div>
                  <div><strong>{movement.type === "stock-in" ? "Stock received" : movement.type === "stock-out" ? "Stock shipped" : "Stock adjusted"}</strong><p>{movement.skuNumber} · {movement.quantity} units · {movement.reason}</p></div>
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
        ) : activePage === "Products" ? (
          <Products user={session.user} />
        ) : activePage === "Inventory" ? (
          <Inventory searchTerm={inventorySearchTerm} />
        ) : activePage === "Orders" ? (
          <Orders />
        ) : activePage === "Settings" ? (
          <SettingsPage user={session.user} />
        ) : (
          <OtherPages key={activePage} activePage={activePage} user={session.user} />
        )}
      </main>
    </div>
  );
}

export default App;
