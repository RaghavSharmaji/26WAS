function availableQuantity(pallet) {
  if (!pallet || ['receiving', 'damaged'].includes(pallet.status)) return 0;
  const onHand = Number(pallet.cont || 0);
  const quarantined = Number(pallet.contQuarantined || 0);
  const physicalAvailable = Math.max(0, onHand - quarantined);
  const declaredAvailable = pallet.contAvailable == null ? physicalAvailable : Number(pallet.contAvailable);
  return Number.isFinite(declaredAvailable) ? Math.min(physicalAvailable, Math.max(0, declaredAvailable)) : 0;
}

function availableQuantityExpression() {
  const legacyAvailable = {
    $max: [0, { $subtract: [{ $ifNull: ['$cont', 0] }, { $ifNull: ['$contQuarantined', 0] }] }]
  };
  return {
    $cond: [
      { $in: ['$status', ['receiving', 'damaged']] },
      0,
      {
        $min: [
          { $max: [0, { $ifNull: ['$contAvailable', legacyAvailable] }] },
          legacyAvailable
        ]
      }
    ]
  };
}

module.exports = { availableQuantity, availableQuantityExpression };
