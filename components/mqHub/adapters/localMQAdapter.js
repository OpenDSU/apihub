function LocalMQAdapter(server, prefix, domain, configuration) {
    const logger = $$.getLogger("LocalMQAdapter", "apihub/mqHub");
    const config = require("../../../http-wrapper/config");
    const swarmUtils = require('swarmutils');
    let path = swarmUtils.path;
    const FILENAME_DELIMITER = "_special_mqs_delimiter_";

    let storage = config.getConfig('componentsConfig', 'mqs', 'storage');
    let domainConfig = config.getDomainConfig(domain);
    if (typeof storage === "undefined") {
        storage = path.join(server.rootFolder, "external-volume", "mqs", domain);
    } else {
        storage = path.join(path.resolve(storage), domain);
    }

    const settings = {
        mq_fsStrategyStorageFolder: storage,
        mq_messageMaxSize: domainConfig["mq_messageMaxSize"] || 10 * 1024,
        mq_queueLength: domainConfig["mq_queueLength"] || 10000
    };

    const MQAdapterMixin = require("./MQAdapterMixin");
    MQAdapterMixin(this, server, prefix, domain, configuration);

    this.loadQueue = (queueName, callback) => {
        require('fs').readdir(getQueueStoragePath(queueName), (err, files) => {
            if (err) {
                if (err.code !== "ENOENT") {
                    return callback(err);
                }
                //storage folder for the queue doesn't exist => empty queue
                return callback(undefined, []);
            }
            let messages = files.filter(fileNamesAsTimestamp => {
                fileNamesAsTimestamp = sanitizeFileName(fileNamesAsTimestamp);
                let valid = (new Date(Number(fileNamesAsTimestamp))).getTime() > 0;
                if (!valid) {
                    logger.debug(`Found garbage in queue ${queueName} (file: ${fileNamesAsTimestamp}). Ignoring it!`);
                }
                return valid;
            });

            messages.sort(function (a, b) {
                a = sanitizeFileName(a);
                b = sanitizeFileName(b);
                return (new Date(Number(a))).getTime() - (new Date(Number(b))).getTime();
            });
            return callback(undefined, messages);
        });
    }

    function getQueueStoragePath(queueName) {
        const opendsu = require("opendsu");
        const crypto = opendsu.loadAPI('crypto');
        if (queueName.indexOf(':') !== -1) {
            queueName = crypto.encodeBase58(queueName);
        }
        return path.join(settings.mq_fsStrategyStorageFolder, queueName);
    }

    function sanitizeFileName(filename) {
        if (filename.indexOf(FILENAME_DELIMITER) !== -1) {
            //if we find filename_delimiter in filename then we need to remove the delimiter in order to be able to sort the queue
            filename = filename.split(FILENAME_DELIMITER)[0];
        }
        return filename;
    }

    function constructFileName(proposedFileName, callback) {
        let finalName = proposedFileName;
        let filename = sanitizeFileName(finalName);
        let counter = -1;

        let FS = require('fs');

        if (filename !== finalName) {
            counter = Number(finalName.replace(filename + FILENAME_DELIMITER, ""));
        }

        let exists = FS.statSync(finalName, {throwIfNoEntry: false});
        if (!exists) {
            try {
                FS.writeFileSync(finalName, "");
            } catch (e) {
                //we ignore this e on purpose
            }
            callback(undefined, finalName);
        } else {
            counter++;
            finalName = filename + FILENAME_DELIMITER + counter;
            constructFileName(finalName, callback);
        }
    }

    this.storeMessage = (queueName, message, callback) => {
        const queueDir = getQueueStoragePath(queueName);
        require('fs').mkdir(queueDir, {recursive: true}, (err) => {
            if (err) {
                return callback(err);
            }

            let fileName = path.join(getQueueStoragePath(queueName), new Date().getTime());
            let FS = require('fs');
            constructFileName(fileName, (err, finalName) => {
                FS.writeFile(finalName, message, (err) => {
                    if (err) {
                        return callback(err);
                    }
                    return callback(undefined, finalName);
                });
            });
        });
    }

    function getMessagePath(queueName, messageId) {
        return path.join(getQueueStoragePath(queueName), messageId);
    }

    this.getMessage = (queueName, messageId, callback) => {
        let fileName = getMessagePath(queueName, messageId);
        require('fs').readFile(fileName, (err, message) => {
            if (err) {
                return callback(err);
            }
            return callback(undefined, {message: message.toString(), messageId});
        });
    }

    this.deleteMessage = (queueName, messageId, callback) => {
        let fileName = getMessagePath(queueName, messageId);
        require('fs').unlink(fileName, callback);
    }

    logger.debug(`Loading Local MQ Adapter for domain: ${domain}`);
}


module.exports = LocalMQAdapter;