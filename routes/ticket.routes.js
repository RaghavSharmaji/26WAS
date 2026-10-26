const express = require('express');
const router = express.Router();
const Pallet = require('../model/Pallets');
const Orders = require('../model/Order');
const Ticket = require('../model/Ticket');
const Product = require('../model/Product');
const inventoryService = require('../services/inventoryService');

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
  let not_found = [];
  const order_id = req.body['order_id'];
  const customer_id = req.body['customerId'];
  const newTicket = new Ticket();
  let products = [];
  let order = await Orders.findOne({ _id: order_id, status: 'create' });
  if (!order) return res.json({ success: false, message: 'Order not fond' });
  for (const line of order.items) {
    const requested = Number(line.cont);
    const totals = await Pallet.aggregate([
      { $match: { skuNumber: line.skuNumber, location: { $exists: true } } },
      { $group: { _id: null, totalValue: { $sum: { $ifNull: ['$contAvailable', '$cont'] } } } }
    ]);
    const available = totals.length ? totals[0].totalValue : 0;
    if (!Number.isInteger(requested) || requested <= 0 || requested > available) {
      not_found.push(line);
      continue;
    }

    let remaining = requested;
    const pallets = await Pallet.find({ skuNumber: line.skuNumber, location: { $exists: true } }).sort({ date: 1 });
    for (const pallet of pallets) {
      if (remaining <= 0) break;
      const palletAvailable = Number(pallet.contAvailable == null ? pallet.cont || 0 : pallet.contAvailable);
      const toPick = Math.min(remaining, palletAvailable);
      if (toPick <= 0) continue;
      await inventoryService.changePalletStock({
        palletId: pallet._id,
        type: 'stock-out',
        quantity: toPick,
        reason: `Order ${order._id} fulfillment`,
        userId: req.auth.id
      });
      const product = new Product({
        location: pallet.location,
        sku_number: pallet.skuNumber,
        cont: toPick,
        cont_to_be_pick: toPick,
        ticketId: newTicket._id
      });
      products.push(product._id);
      await product.save();
      remaining -= toPick;
    }
    if (remaining > 0) not_found.push({ skuNumber: line.skuNumber, cont: remaining });
  }

  try {
    newTicket['status'] = 'plash';
    newTicket['customerId'] = customer_id;
    newTicket['products'] = products;

    await newTicket.save();
    order.status = 'plash';
    order.itemsI = not_found;
    order.ticketsId = newTicket._id;
    await order.save();
    res.json({
      success: true,
      message: 'Ticket created',
      newTicket,
      itemI: order.itemI
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      err: err
    });
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

router.delete('/delete', async (req, res) => {
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
