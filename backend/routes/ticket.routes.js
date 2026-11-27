const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Pallet = require('../model/Pallets');
const Orders = require('../model/Order');
const Ticket = require('../model/Ticket');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Warehouse = require('../model/Warehouse');
const { requireCompanyRole } = require('../middleware/companyAuthorization');
const Product = require('../model/Product');
const inventoryService = require('../services/inventoryService');
const { availableQuantity } = require('../services/inventoryBalance');
const { runWithAuth } = require('../middleware/requestContext');

router.get('/', async (req, res) => {
  try {
    const allTicket = await Ticket.find();
    res.json({
      success: true,
      message: 'all Ticket',
      allTicket
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.post('/create', async (req, res) => {
  const orderId = req.body && req.body.order_id;
  const customerId = req.body && req.body.customerId;
  // No tenant-aware Customer model or lookup exists yet, so accepting a caller
  // supplied customer reference here could attach another company's customer.
  if (customerId) {
    return res.status(400).json({ success: false, message: 'customerId cannot be set until customer ownership validation is available' });
  }
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'A valid order_id is required' });
  }

  const session = await mongoose.startSession();
  try {
    let fulfillment;
    await runWithAuth(req.tenantAuth || req.auth, () => session.withTransaction(async () => {
      // Re-read within the transaction. The order state is also the one-time
      // fulfillment claim: concurrent attempts conflict and the loser retries
      // against the committed non-create state.
      const order = await Orders.findOne({ _id: orderId }).session(session);
      if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
      if (order.status !== 'create') {
        throw Object.assign(new Error('Order has already been fulfilled or is not ready for fulfillment'), { status: 409 });
      }

      let warehouseId = order.warehouseId ? String(order.warehouseId) : null;
      if (req.tenant?.companyId) {
        const [company, membership] = await Promise.all([
          Company.findOne({ _id: req.tenant.companyId, status: 'active' }).session(session).select('_id').lean(),
          CompanyMembership.findOne({
            _id: req.tenant.membershipId,
            userId: req.auth.id,
            companyId: req.tenant.companyId,
            status: 'active',
            role: req.tenant.membershipRole
          }).session(session).lean()
        ]);
        if (!company || !membership) {
          throw Object.assign(new Error('Active company membership is required'), { status: 403 });
        }
        warehouseId = warehouseId || req.tenant.activeWarehouseId;
        if (!warehouseId || !mongoose.Types.ObjectId.isValid(String(warehouseId))) {
          throw Object.assign(new Error('A valid order warehouse is required for fulfillment'), { status: 400 });
        }
        if (membership.role !== 'company_admin'
          && !(membership.assignedWarehouseIds || []).some(id => String(id) === String(warehouseId))) {
          throw Object.assign(new Error('You are not assigned to the order warehouse'), { status: 403 });
        }
        if (req.tenant.activeWarehouseId && String(req.tenant.activeWarehouseId) !== String(warehouseId)) {
          throw Object.assign(new Error('The order warehouse does not match the selected warehouse'), { status: 403 });
        }
        const warehouse = await Warehouse.findOne({ _id: warehouseId, companyId: req.tenant.companyId, active: true })
          .session(session).select('_id').lean();
        if (!warehouse) throw Object.assign(new Error('Order warehouse is not available in this company'), { status: 404 });
        if (!order.warehouseId) order.warehouseId = warehouse._id;
      }

      const ticket = new Ticket({
        ownerId: req.auth.id,
        companyId: req.tenant?.companyId || null,
        ...(warehouseId ? { warehouseId } : {}),
        status: 'plash',
        customerId: customerId || undefined,
        products: []
      });
      const unfulfilled = [];
      const productRecords = [];

      for (const line of order.items || []) {
        const requested = Number(line.cont);
        if (!Number.isInteger(requested) || requested <= 0) {
          unfulfilled.push(line);
          continue;
        }

        const criteria = {
          skuNumber: line.skuNumber,
          location: { $exists: true },
          status: { $nin: ['receiving', 'damaged'] },
          ...(warehouseId ? { warehouseId } : {})
        };
        const pallets = await Pallet.find(criteria).sort({ date: 1 }).session(session).lean();
        const available = pallets.reduce((sum, pallet) => sum + availableQuantity(pallet), 0);
        if (requested > available) {
          // Preserve the existing workflow: a short SKU line is recorded as
          // unfulfilled without picking part of that line.
          unfulfilled.push(line);
          continue;
        }
        let remaining = requested;
        for (const pallet of pallets) {
          if (remaining <= 0) break;
          const palletAvailable = availableQuantity(pallet);
          const toPick = Math.min(remaining, palletAvailable);
          if (toPick <= 0) continue;
          await inventoryService.changePalletStock({
            palletId: pallet._id,
            type: 'stock-out',
            quantity: toPick,
            reason: `Order ${order._id} fulfillment`,
            userId: req.auth.id,
            session
          });
          productRecords.push(new Product({
            // These values come from authenticated server context, never the
            // request body. Keep them explicit as well as running the save
            // hook inside the verified AsyncLocalStorage context.
            ownerId: req.auth.id,
            companyId: req.tenant?.companyId || null,
            location: pallet.location,
            sku_number: pallet.skuNumber,
            cont: toPick,
            cont_to_be_pick: toPick,
            ticketId: ticket._id,
            ...(warehouseId ? { warehouseId } : {})
          }));
          remaining -= toPick;
        }
        if (remaining > 0) {
          throw Object.assign(new Error('Inventory allocation changed while fulfilling the order'), { status: 409 });
        }
      }

      if (productRecords.length) {
        for (const product of productRecords) await product.save({ session });
      }
      ticket.products = productRecords.map(product => product._id);
      await ticket.save({ session });
      order.status = 'plash';
      order.itemsI = unfulfilled;
      order.ticketsId = ticket._id;
      await order.save({ session });
      fulfillment = { ticket, order };
    }));

    res.json({
      success: true,
      message: 'Ticket created',
      newTicket: fulfillment.ticket,
      itemI: fulfillment.order.itemsI
    });
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) console.error('Ticket fulfillment transaction failed:', err.message);
    res.status(status).json({ success: false, message: status >= 500 ? 'Could not fulfill the order' : err.message });
  } finally {
    await session.endSession();
  }
});

router.get('/find/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const ticket = await Ticket.findOne({ _id: id });
    if (!ticket)
      return res.json({ success: false, message: 'Ticket is not fond' });
    res.json({
      success: true,
      message: 'find one',
      ticket
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

router.delete('/delete', requireCompanyRole('company_admin'), async (req, res) => {
  const { id } = req.body;
  try {
    const resolve = await Ticket.deleteOne({ _id: id });
    res.json({
      message: 'done',
      data: resolve
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
  }
});

module.exports = router;
