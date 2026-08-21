const {
  PlatformAdminError,
  authenticatePlatformAdmin,
} = require("../services/platformAdminService");

const createPlatformLogin = ({ authenticate = authenticatePlatformAdmin, logger = console } = {}) =>
  async (req, res) => {
    try {
      const result = await authenticate({ email: req.body?.email, password: req.body?.password });
      return res.status(200).json({
        message: "Platform login successful",
        token: result.token,
        admin: result.admin,
      });
    } catch (error) {
      if (error instanceof PlatformAdminError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      logger.error("Platform login failed");
      return res.status(500).json({ message: "Platform login failed", code: "PLATFORM_LOGIN_FAILED" });
    }
  };

module.exports = {
  createPlatformLogin,
  platformLogin: createPlatformLogin(),
};
