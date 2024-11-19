function LokiMQAdapter(server, prefix, domain, configuration) {
    const logger = $$.getLogger("LokiMQAdapter", "apihub/mqHub");
    const config = require("../../../http-wrapper/config");
    let domainConfig = config.getDomainConfig(domain);
    const path = require("path");
    let storage = config.getConfig('componentsConfig', 'mqs', 'storage');
    if (typeof storage === "undefined") {
        storage = path.join(server.rootFolder, "external-volume", "mqs", domain, "messages");
    } else {
        storage = path.join(path.resolve(storage), domain);
    }
    const fs = require("fs");
    try {
        fs.accessSync(storage);
    } catch (err) {
        fs.mkdirSync(path.dirname(storage), {recursive: true});
    }
    const lokiEnclaveFacadeModule = require("loki-enclave-facade");
    const lokiEnclaveFacadeInstance = lokiEnclaveFacadeModule.createLokiEnclaveFacadeInstance(storage);

    const settings = {
        mq_messageMaxSize: domainConfig["mq_messageMaxSize"] || 10 * 1024,
        mq_queueLength: domainConfig["mq_queueLength"] || 10000
    };

    Object.assign(settings, configuration);

    const MQAdapterMixin = require("./MQAdapterMixin");
    MQAdapterMixin(this, server, prefix, domain, configuration);

    this.loadQueue = (queueName, callback) => {
        lokiEnclaveFacadeInstance.listQueue(undefined, queueName, callback);
    }

    this.storeMessage = (queueName, message, callback) => {
        if (typeof message !== "object") {
            message = {message};
        }
        lokiEnclaveFacadeInstance.addInQueue(undefined, queueName, message, true, callback);
    }

    this.getMessage = (queueName, messageId, callback) => {
        lokiEnclaveFacadeInstance.getObjectFromQueue(undefined, queueName, messageId, (err, message) => {
            if (err) {
                return callback(err);
            }
            if (!message) {
                return callback(Error(`Message ${messageId} not found in queue ${queueName}`));
            }

            message.messageId = messageId;
            return callback(undefined, message);
        });
    }

    this.deleteMessage = (queueName, messageId, callback) => {
        lokiEnclaveFacadeInstance.deleteObjectFromQueue(undefined, queueName, messageId, callback);
    }

    logger.debug(`Loading Loki MQ Adapter for domain: ${domain}`);
}

module.exports = LokiMQAdapter;
