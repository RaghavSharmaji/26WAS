module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON request body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large' });
  }
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: 'A record with that unique value already exists' });
  }
  if (err.status) {
    return res.status(err.status).json({ success: false, message: err.message });
  }

  console.error(err.message);
  return res.status(500).json({ success: false, message: 'Internal server error' });
};
