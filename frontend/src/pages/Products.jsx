
import { useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Package,
} from "lucide-react";

const initialProducts = [
  { id: 1, name: "Wireless Headphones", category: "Electronics", price: 2499, stock: 145 },
  { id: 2, name: "Mechanical Keyboard", category: "Accessories", price: 3999, stock: 12 },
  { id: 3, name: "Smart Watch", category: "Electronics", price: 5499, stock: 0 },
  { id: 4, name: "USB-C Hub", category: "Accessories", price: 1299, stock: 86 },
  { id: 5, name: "Bluetooth Speaker", category: "Electronics", price: 2199, stock: 8 },
];

function Products() {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);

  const [form, setForm] = useState({
    name: "",
    category: "Electronics",
    price: "",
    stock: "",
  });

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!form.name.trim() || form.price === "" || form.stock === "") {
      alert("Please fill all fields");
      return;
    }

    const newProduct = {
      ...form,
      price: Number(form.price),
      stock: Number(form.stock),
    };

    if (editId !== null) {
      setProducts(products.map((p) =>
        p.id === editId ? { ...newProduct, id: editId } : p
      ));
    } else {
      setProducts([
        ...products,
        { ...newProduct, id: Date.now() },
      ]);
    }

    closeForm();
  };

  const openEdit = (product) => {
    setEditId(product.id);
    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      stock: String(product.stock),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm({
      name: "",
      category: "Electronics",
      price: "",
      stock: "",
    });
  };

  const deleteProduct = (id) => {
    if (window.confirm("Are you sure you want to delete this product?")) {
      setProducts(products.filter((p) => p.id !== id));
    }
  };

  const getStatus = (stock) => {
    if (stock === 0) return "Out of Stock";
    if (stock <= 15) return "Low Stock";
    return "In Stock";
  };

  return (
    <div className="products-page">

      <div className="page-heading">
        <div>
          <h1>Products</h1>
          <p>Manage and monitor all your warehouse products.</p>
        </div>

        <button className="primary-btn" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add Product
        </button>
      </div>

      <div className="product-summary">
        <div className="panel">
          <Package size={23} color="#3478ed" />
          <p>Total Products</p>
          <h2>{products.length}</h2>
        </div>

        <div className="panel">
          <Package size={23} color="#20a66b" />
          <p>In Stock</p>
          <h2>{products.filter(p => p.stock > 15).length}</h2>
        </div>

        <div className="panel">
          <Package size={23} color="#e69a36" />
          <p>Low Stock</p>
          <h2>{products.filter(p => p.stock > 0 && p.stock <= 15).length}</h2>
        </div>

        <div className="panel">
          <Package size={23} color="#df625b" />
          <p>Out of Stock</p>
          <h2>{products.filter(p => p.stock === 0).length}</h2>
        </div>
      </div>

      <div className="panel products-table-panel">

        <div className="products-toolbar">
          <div>
            <h3>All Products</h3>
            <p>View and manage your product inventory</p>
          </div>

          <div className="search-box">
            <Search size={17} />
            <input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>CATEGORY</th>
                <th>PRICE</th>
                <th>STOCK</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <small>PRD-{String(product.id).slice(-5)}</small>
                  </td>

                  <td>{product.category}</td>
                  <td>₹{product.price.toLocaleString("en-IN")}</td>
                  <td>{product.stock}</td>

                  <td>
                    <span className={`status ${
                      getStatus(product.stock).toLowerCase().replaceAll(" ", "-")
                    }`}>
                      {getStatus(product.stock)}
                    </span>
                  </td>

                  <td>
                    <div className="action-buttons">
                      <button
                        className="edit-btn"
                        onClick={() => openEdit(product)}
                        title="Edit product"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        className="delete-btn"
                        onClick={() => deleteProduct(product.id)}
                        title="Delete product"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "30px" }}>
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay">
          <div className="product-modal">

            <div className="modal-header">
              <div>
                <h2>{editId !== null ? "Edit Product" : "Add New Product"}</h2>
                <p>Enter the product details below.</p>
              </div>

              <button className="close-btn" onClick={closeForm}>
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>

              <label>Product Name</label>
              <input
                required
                placeholder="Enter product name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />

              <label>Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option>Electronics</option>
                <option>Accessories</option>
                <option>Furniture</option>
                <option>Clothing</option>
                <option>Other</option>
              </select>

              <label>Price (₹)</label>
              <input
                required
                type="number"
                min="0"
                placeholder="Enter price"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />

              <label>Stock Quantity</label>
              <input
                required
                type="number"
                min="0"
                placeholder="Enter stock quantity"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />

              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={closeForm}>
                  Cancel
                </button>

                <button type="submit" className="primary-btn">
                  {editId !== null ? "Update Product" : "Save Product"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default Products;
