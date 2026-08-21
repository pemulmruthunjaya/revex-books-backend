const db = require("../db/connection");
const { verifyAuthToken } = require("../utils/jwtToken");

const createPlatformAuthMiddleware = ({ executor = db, verifyToken = verifyAuthToken } = {}) =>
  async (req, res, next) => {
    try {
      const [scheme, token] = String(req.headers.authorization || "").split(" ");
      if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ message: "Platform authentication required" });
      }
      const claims = verifyToken(token);
      if (claims.actor_type !== "platform_admin" || claims.role !== "platform_admin") {
        return res.status(403).json({ message: "Platform administrator access required" });
      }
      const adminId = Number(claims.sub);
      if (!Number.isSafeInteger(adminId) || adminId <= 0) {
        return res.status(401).json({ message: "Invalid platform session" });
      }
      const [rows] = await executor.query(
        "SELECT id, name, email, status FROM platform_admins WHERE id = ? LIMIT 1",
        [adminId]
      );
      if (!rows.length || rows[0].status !== "active") {
        return res.status(403).json({ message: "Platform administrator access is disabled" });
      }
      req.platformAdmin = {
        id: Number(rows[0].id),
        name: rows[0].name,
        email: rows[0].email,
        actor_type: "platform_admin",
      };
      return next();
    } catch (error) {
      const message = error?.name === "TokenExpiredError" ? "Platform session expired" : "Invalid platform session";
      return res.status(401).json({ message });
    }
  };

module.exports = createPlatformAuthMiddleware();
module.exports.createPlatformAuthMiddleware = createPlatformAuthMiddleware;
