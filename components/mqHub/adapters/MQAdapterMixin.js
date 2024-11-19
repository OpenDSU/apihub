function MQAdapterMixin(target, server, prefix, domain, configuration) {
    const logger = $$.getLogger("MQAdapterMixin", "apihub/mqHub");

    const subscribers = {};
    const config = require("../../../http-wrapper/config");
    let domainConfig = config.getDomainConfig(domain);
    const utils = require('../../../http-wrapper/utils');
    const readBody = utils.streams.readStringFromStream;

    const settings = {
        mq_messageMaxSize: domainConfig["mq_messageMaxSize"] || 10 * 1024,
        mq_queueLength: domainConfig["mq_queueLength"] || 10000
    };

    Object.assign(settings, configuration);

    function send(res, statusCode, message, headers) {
        res.statusCode = statusCode;

        if (headers) {
            for (let prop in headers) {
                try {
                    res.setHeader(prop, headers[prop]);
                } catch (e) {
                    logger.error(`Failed to set headers after end() was called.`, e);
                    return;
                }
            }
        }

        if (message) {
            res.write(message);
        }
        res.end();
    }

    function checkQueueLoad(queueName, callback) {
        target.loadQueue(queueName, (err, files) => {
            if (err) {
                return callback(err);
            }
            callback(undefined, files.length);
        });
    }

    function _readMessage(queueName, messageId, callback) {
        if (typeof messageId === "function") {
            callback = messageId;
            messageId = undefined;
        }
        target.loadQueue(queueName, (err, messageIds) => {
            if (err) {
                return callback(err);
            }

            if (typeof messageId !== "undefined") {
                if (messageIds.indexOf(messageId) !== -1) {
                    return callback(Error("Message not found."));
                }
            } else {
                messageId = messageIds[0];
            }
            return target.getMessage(queueName, messageId, callback);
        });
    }

    function deliverMessage(subs, message, callback) {
        let counter = 0;
        while (subs.length > 0) {
            let sub = subs.pop();
            try {
                sub(undefined, message);
                counter++;
            } catch (err) {
                //if something happens during message delivery we will catch the error here
            }
        }
        callback(undefined, counter);
    }

    function putMessage(queueName, message, callback) {
        checkQueueLoad(queueName, (err, capacity) => {
            if (err) {
                return callback(err);
            }

            if (typeof subscribers[queueName] === 'undefined') {
                subscribers[queueName] = [];
            }

            const capacityLimit = Number(settings.mq_queueLength);

            if (capacity > capacityLimit) {
                const err = new Error("Queue size exceeded!");
                err.sendToUser = true;
                return callback(err);
            }

            if (capacity > 0) {
                return target.storeMessage(queueName, message, callback);
            }

            //if queue is empty we should try to deliver the message to a potential subscriber that waits
            const subs = subscribers[queueName];
            target.storeMessage(queueName, message, (err) => {
                if (err) {
                    return callback(err);
                }
                return _readMessage(queueName, (err, _message) => {
                    if (err) {
                        return callback(err);
                    }
                    deliverMessage(subs, _message, callback);
                });
            })
        });
    }

    function readMessage(queueName, callback) {
        checkQueueLoad(queueName, (err, capacity) => {
            if (err) {
                return callback(err);
            }

            if (typeof subscribers[queueName] === 'undefined') {
                subscribers[queueName] = [];
            }

            const subs = subscribers[queueName];
            subs.push(callback);

            if (capacity) {
                return _readMessage(queueName, (err, message) => {
                    deliverMessage(subs, message, (err, successCount) => {
                        if (err) {
                            logger.error(err);
                        }

                        logger.debug(`Successfully sent message to a number of ${successCount} subs.`);
                    });
                });
            } else {
                //no message available in queue
            }
        });
    }

    function putMessageHandler(request, response) {
        let queueName = request.params.queueName;
        readBody(request, (err, message) => {
            if (err) {
                logger.error(`Caught an error during body reading from put message request`, err);
                return send(response, 500);
            }

            if (typeof settings.mq_messageMaxSize !== "undefined") {
                const messageMaxSize = Number(settings.mq_messageMaxSize);
                try {
                    let messageAsBuffer = Buffer.from(message);
                    if (messageAsBuffer.length > messageMaxSize) {
                        send(response, 403, "Message size exceeds domain specific limit.");
                        return;
                    }
                } catch (err) {
                    logger.error("Not able to confirm message size. Going on with the flow...");
                }
            }

            putMessage(queueName, message, (err) => {
                if (err) {
                    logger.error(`Caught an error during adding message to queue`, err);
                    return send(response, 500, err.sendToUser ? err.message : undefined);
                }
                send(response, 200);
            });
        });
    }

    function getMessageHandler(request, response) {
        let queueName = request.params.queueName;
        let wasCalled = false;
        const readMessageCallback = (err, message) => {
            if (wasCalled) {
                return;
            }
            wasCalled = true;
            if (err) {
                send(response, 500);
                return;
            }
            send(response, 200, JSON.stringify(message), {'Content-Type': 'application/json'});
        };

        const mqConfig = config.getConfig("componentsConfig", "mq");
        if (mqConfig && mqConfig.connectionTimeout) {
            setTimeout(() => {
                if (!wasCalled) {
                    if (subscribers[queueName]) {
                        const fnRefIndex = subscribers[queueName].findIndex(fn => fn === readMessageCallback);
                        if (fnRefIndex >= 0) {
                            subscribers[queueName].splice(fnRefIndex, 1);
                        }
                    }
                    response.statusCode = 204;
                    response.end();
                }
            }, mqConfig.connectionTimeout);
        }

        readMessage(queueName, readMessageCallback);
    }

    function deleteMessageHandler(request, response) {
        let {queueName, messageId} = request.params;
        target.deleteMessage(queueName, messageId, (err) => {
            if (err) {
                logger.error(`Caught an error during deleting message ${messageId} from queue ${queueName}`, err);
            }
            send(response, err ? 500 : 200);
        });
    }

    function takeMessageHandler(request, response) {
        const queueName = request.params.queueName;
        readMessage(queueName, (err, message) => {
            if (err) {
                logger.error(`Caught an error during message reading from ${queueName}`, err);
                send(response, 500);
                return;
            }
            target.deleteMessage(queueName, message.messageId, (err) => {
                if (err) {
                    logger.error(`Caught an error during message deletion from ${queueName} on the take handler`, err);
                    return send(response, 500);
                }

                return send(response, 200, JSON.stringify(message), {'Content-Type': 'application/json'});
            });
        });
    }

    server.put(`${prefix}/${domain}/put/:queueName`, putMessageHandler); //< message

    server.get(`${prefix}/${domain}/get/:queueName/:signature_of_did`, getMessageHandler); //  > {message}
    server.delete(`${prefix}/${domain}/delete/:queueName/:messageId/:signature_of_did`, deleteMessageHandler);

    server.get(`${prefix}/${domain}/take/:queueName/:signature_of_did`, takeMessageHandler); //  > message
}

module.exports = MQAdapterMixin;