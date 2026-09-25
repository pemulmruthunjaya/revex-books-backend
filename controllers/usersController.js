const db = require('../db/connection');
const { ensureUserAccessColumns } = require("../services/userAccessService");

// GET all users
exports.getUsers = async (req, res) => {
  try {
    await ensureUserAccessColumns();

    const [users] = await db.query(
      `SELECT id, name, email, role, access_role, created_at
       FROM users
       WHERE company_id = ?
       ORDER BY id DESC`,
      [req.user.company_id]
    );

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "An unexpected error occurred", code: "INTERNAL_SERVER_ERROR", request_id: req.requestId || null });
  }
};

// CREATE user
exports.createUser = (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const sql = 'INSERT INTO users (name, email) VALUES (?, ?)';
  db.query(sql, [name, email], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "An unexpected error occurred", code: "INTERNAL_SERVER_ERROR", request_id: req.requestId || null });
    }

    res.status(201).json({
      message: 'User created successfully',
      user: { id: result.insertId, name, email }
    });
  });
};

// UPDATE user
exports.updateUser = (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;

  const sql = 'UPDATE users SET name = ?, email = ? WHERE id = ?';
  db.query(sql, [name, email, id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "An unexpected error occurred", code: "INTERNAL_SERVER_ERROR", request_id: req.requestId || null });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated successfully' });
  });
};

// DELETE user
exports.deleteUser = (req, res) => {
  const { id } = req.params;

  const sql = 'DELETE FROM users WHERE id = ?';
  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "An unexpected error occurred", code: "INTERNAL_SERVER_ERROR", request_id: req.requestId || null });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  });
};
