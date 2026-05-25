const { logAction } = require("../services/actionLogger");
const badgeEventMap = require("../services/badgeEventMap");

function actionLogMiddleware(req, res, next) {
  const originalJson = res.json;

  res.json = function (body) {
    try {
      const userId = req.user?.id || null;

      if (userId) {
        const route = `${req.baseUrl || ""}${req.route?.path || ""}`;
        const rawActionType = `${req.method} ${route}`;
        const actionType = badgeEventMap[rawActionType] || rawActionType;

        logAction({
          user_id: userId,
          source: "backend",
          action_type: actionType,
          method: req.method,
          route,
          status_code: res.statusCode,
          metadata: {
            raw_action_type: rawActionType,
            params: req.params,
            query: req.query,
            body_keys: Object.keys(req.body || {}),
          },
        });
      }
    } catch (err) {
      console.warn("[actionLogMiddleware]", err.message);
    }

    return originalJson.call(this, body);
  };

  next();
}

module.exports = actionLogMiddleware;