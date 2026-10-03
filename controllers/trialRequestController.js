const { TrialRequestError, submitTrialRequest } = require("../services/trialRequestService");

const createTrialRequestController = ({ submit = submitTrialRequest } = {}) => async (req, res) => {
  try {
    const result = await submit({ body: req.body, gateway: req.trialGateway });
    req.body = undefined;
    return res.status(202).set("Cache-Control", "no-store").json(result);
  } catch (error) {
    req.body = undefined;
    const code = error instanceof TrialRequestError ? error.code : "TRIAL_REQUEST_UNAVAILABLE";
    const status = error instanceof TrialRequestError ? error.status : 503;
    return res.status(status).set("Cache-Control", "no-store").json({ code });
  }
};
module.exports = { createTrialRequestController };
