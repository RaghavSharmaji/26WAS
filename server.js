require('dotenv').config();
require('express-async-errors');
const express = require('express');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const cors = require('cors');
const auth = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const app = express();

const authRoutes = require('./routes/auth.routes');
const locationRoutes = require('./routes/location.routes');
const itemRoutes = require('./routes/item.routes');
const palletRoutes = require('./routes/pallet.routes');
const receivingRoutes = require('./routes/receiving.routes');
const orderRoutes = require('./routes/order.routes');
const ticketRoutes = require('./routes/ticket.routes');
const pickerRoutes = require('./routes/picker.routes');
const userRoutes = require('./routes/user.routes');
const webScrapingRoutes = require('./routes/webscraping.routes');
const productRoutes = require('./routes/products.routes');
const categoryRoutes = require('./routes/category.routes');
const supplierRoutes = require('./routes/supplier.routes');
const warehouseRoutes = require('./routes/warehouse.routes');
const locationCrudRoutes = require('./routes/locationCrud.routes');
const palletCrudRoutes = require('./routes/palletCrud.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const reportRoutes = require('./routes/report.routes');
const adminRoutes = require('./routes/admin.routes');
const ensureSuperAdmin = require('./scripts/ensureSuperAdmin');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('This web origin is not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    success: connected,
    status: connected ? 'ok' : 'database_unavailable'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', auth, auth.requireRole('superadmin'), adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/locations', locationCrudRoutes);
app.use('/api/products', productRoutes);
app.use('/api/items', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/pallets', palletCrudRoutes);
app.use('/api/reports', reportRoutes);

app.use('/api/location', auth, locationRoutes);
app.use('/api/item', auth, itemRoutes);
app.use('/api/pallet', auth, palletRoutes);
app.use('/api/receiving', auth, receivingRoutes);
app.use('/api/order', auth, orderRoutes);
app.use('/api/ticket', auth, ticketRoutes);
app.use('/api/picker', auth, pickerRoutes);
app.use('/api/user', userRoutes);
app.use('/webs/item', auth, webScrapingRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use(errorHandler);

async function start() {
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const mongoUri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim();
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required. Set it in backend/.env (for example: mongodb://127.0.0.1:27017/wms_f).');
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
  }
  if (!process.env.SECRET_OR_KEY || !process.env.SECRET_OR_KEY.trim()) {
    throw new Error('SECRET_OR_KEY is required. Set a private random value in backend/.env.');
  }
  await mongoose.connect(mongoUri);
  await ensureSuperAdmin();
  console.log('MongoDB connected');
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`WMS API listening on port ${port}`);
  return server;
}

if (require.main === module) {
  start().catch(err => {
    console.error(`Startup failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = app;
