function DebugLogger(server) {
    const {responseModifierMiddleware, requestBodyJSONMiddleware} = require('../../http-wrapper/utils/middlewares');
    const {createHandlerAppendToLog, createHandlerReadFromLog} = require('./controllers');

    const appendToLog = createHandlerAppendToLog();
    const readFromLog = createHandlerReadFromLog();

    server.use(`/log/*`, responseModifierMiddleware);
    server.use(`/log/*`, requestBodyJSONMiddleware);

    server.post(`/log/add/:anchorID/:logLevel`, appendToLog);
    server.get(`/log/get/:anchorID`, readFromLog);
}

module.exports = DebugLogger;
