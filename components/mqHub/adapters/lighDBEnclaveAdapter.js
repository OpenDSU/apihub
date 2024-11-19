function LightDBEnclaveAdapter(server, prefix, domain, configuration) {
    const logger = $$.getLogger("LokiMQAdapter", "apihub/mqHub");
    const config = require("../../../http-wrapper/config");
    let domainConfig = config.getDomainConfig(domain);

    const settings = {
        mq_messageMaxSize: domainConfig["mq_messageMaxSize"] || 10 * 1024,
        mq_queueLength: domainConfig["mq_queueLength"] || 10000
    };

    Object.assign(settings, configuration);

    const MQAdapterMixin = require("./MQAdapterMixin");
    MQAdapterMixin(this, server, prefix, domain, configuration);
    const DB_NAME = "mqDB";
    const lightDBEnclaveClient = require("opendsu").loadAPI("enclave").initialiseLightDBEnclave(DB_NAME);
    const ensureDBIsInitialised = (callback) => {
        lightDBEnclaveClient.createDatabase(DB_NAME, (err) => {
            if (!err) {
                return lightDBEnclaveClient.hasWriteAccess($$.SYSTEM_IDENTIFIER, (err, hasAccess) => {
                    if (err) {
                        return callback(err);
                    }

                    if (hasAccess) {
                        return callback();
                    }

                    lightDBEnclaveClient.grantWriteAccess($$.SYSTEM_IDENTIFIER, callback);
                })
            }

            return callback();
        });
    }

    this.loadQueue = (queueName, callback) => {
        ensureDBIsInitialised((err) => {
            if (err) {
                return callback(err);
            }

            lightDBEnclaveClient.listQueue($$.SYSTEM_IDENTIFIER, queueName, callback);
        });
    }

    this.storeMessage = (queueName, message, callback) => {
        if (typeof message !== "object") {
            message = {message};
        }
        ensureDBIsInitialised((err) => {
            if (err) {
                return callback(err);
            }

            lightDBEnclaveClient.addInQueue($$.SYSTEM_IDENTIFIER, queueName, message, true, callback);
        });
    }

    this.getMessage = (queueName, messageId, callback) => {
        ensureDBIsInitialised((err) => {
            if (err) {
                return callback(err);
            }

            lightDBEnclaveClient.getObjectFromQueue($$.SYSTEM_IDENTIFIER, queueName, messageId, (err, message) => {
                if (err) {
                    return callback(err);
                }
                if (!message) {
                    return callback(Error(`Message ${messageId} not found in queue ${queueName}`));
                }

                message.messageId = messageId;
                return callback(undefined, message);
            });
        });
    }

    this.deleteMessage = (queueName, messageId, callback) => {
        ensureDBIsInitialised((err) => {
            if (err) {
                return callback(err);
            }

            lightDBEnclaveClient.deleteObjectFromQueue($$.SYSTEM_IDENTIFIER, queueName, messageId, callback);
        });
    }

    logger.debug(`Loading Loki MQ Adapter for domain: ${domain}`);
}

module.exports = LightDBEnclaveAdapter;
