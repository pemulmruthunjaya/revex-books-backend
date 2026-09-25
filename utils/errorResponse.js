const unexpectedErrorBody = (requestId) => ({
  success: false,
  message: "An unexpected error occurred",
  code: "INTERNAL_SERVER_ERROR",
  request_id: requestId || null,
});

const sendUnexpectedError = (req, res, error, context = "API request") => {
  console.error(`${context} failed`, {
    requestId: req?.requestId || null,
    name: error?.name,
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  });
  return res.status(500).json(unexpectedErrorBody(req?.requestId));
};

module.exports = { sendUnexpectedError, unexpectedErrorBody };
