const defaultConfig = {
    "storage": require("swarmutils").path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, "tmp"),
    "externalStorage": "./external-volume",
    "sslFolder": require("swarmutils").path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, "conf", "ssl"),
    "port": 8080,
    "host": "0.0.0.0",
    "zeromqForwardAddress": "tcp://127.0.0.1:5001",
    "preventRateLimit": false,
    // staticServer needs to load last
    "activeComponents": ["config", "mq", "secrets", "notifications", "bdns", "bricking", "anchoring", 'debugLogger', "mainDSU", "cloudWallet", "versionlessDSU", "stream", "lightDBEnclave", "staticServer"],
    "componentsConfig": {
        "mq": {
            "module": "./components/mqHub",
            "function": "MQHub",
            "connectionTimeout": 10000
        },
        "secrets": {
            "module": "./components/secrets"
        },
        "notifications": {
            "module": "./components/keySsiNotifications",
            "workingDirPath": "./external-volume/notifications"
        },
        "bdns": {
            "module": "./components/bdns",
        },
        "bricking": {
            "module": "./components/bricking",
        },
        "anchoring": {
            "module": "./components/anchoring",
            "anchoringStrategy": "FS"
        },
        "debugLogger": {
            "module": './components/debugLogger',
            "workingDirPath": './external-volume/debug-logger',
            "storageDirPath": './external-volume/debug-logger/storage',
        },
        "staticServer": {
            "module": "./components/staticServer",
            "cacheDurations": []
        },
        "contracts": {
            "module": "./components/contracts",
            "domainsPath": "/external-volume/domains"
        },
        "admin": {
            "module": "./components/admin",
            "function": "AdminComponentHandler",
            "storageFolder": './external-volume/config/admin'
        },
        "mainDSU": {
            "module": "./components/mainDSU"
        },
        "cloudWallet": {
            "module": "./components/cloudWallet",
            "dsuBootPath": "./builds/output/nodeBoot.js"
        },
        "stream": {
            "module": "./components/stream"
        },
        "versionlessDSU": {
            "module": "./components/versionlessDSU"
        },
        "requestForwarder": {
            "module": "./components/requestForwarder"
        },
        "lightDBEnclave": {
            "module": "./components/lightDBEnclave",
        },
        "requestLogger": {
            "comment": "this is a standard middleware but its config is here to make it as uniform as possible",
            "statusLogInterval": 3000,
            "longRequests": ["/mq/"]
        },
        "activeComponents": {
            "module": "./components/activeComponents",
        }
    },
    "tokenBucket": {
        "cost": {
            "low": 10,
            "medium": 100,
            "high": 500
        },
        "error": {
            "limitExceeded": "error_limit_exceeded",
            "badArgument": "error_bad_argument"
        },
        "startTokens": 6000,
        "tokenValuePerTime": 10,
        "unitOfTime": 100
    },
    "enableInstallationDetails": false,
    "enableRequestLogger": true,
    "enableJWTAuthorisation": false,
    "enableSimpleAuth": false,
    "enableAPIKeyAuth": false,
    "enableClientCredentialsOauth": false,
    "enableLocalhostAuthorization": false,
    "enableErrorCloaking": false,
    "enableReadOnlyMechanism": true,
    "readOnlyFile": "readonly",
    "readOnlyInterval": 60000,
    "skipJWTAuthorisation": [
        "/leaflet-wallet",
        "/config",
        "/anchor",
        "/bricking",
        "/bricksFabric",
        "/create-channel",
        "/send-message",
        "/receive-message",
        "/files",
        "/notifications",
        "/mq",
        "/enclave",
        "/secrets",
        "/logs"
    ],
    "oauthConfig":{
        "whitelist":[]
    }
};

module.exports = Object.freeze(defaultConfig);
