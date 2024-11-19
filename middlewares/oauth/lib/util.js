const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const http = openDSU.loadAPI("http");
const fs = require("fs");
const errorMessages = require("./errorMessages");
const path = require("path");
const logger = $$.getLogger("OAuthMiddleware", "util.js");

let publicKey;

const PREVIOUS_ENCRYPTION_KEY_FILE = "previousEncryptionKey.secret";
const CURRENT_ENCRYPTION_KEY_FILE = "currentEncryptionKey.secret";

function KeyManager(storage, rotationInterval) {
    let current;
    let previous;

    const logger = $$.getLogger("OAuthMiddleware", "oauth/keyManager");

    function getPath(filename) {
        const path = require("path");
        return path.join(storage, filename);
    }

    function persist(filename, key, callback) {
        logger.debug("Writing", filename);
        fs.writeFile(getPath(filename), key, callback);
    }

    function getAge(lastModificationTime) {
        let timestamp = new Date().getTime();
        let converted = new Date(lastModificationTime).getTime();
        let age = timestamp - converted;
        //logger.debug("age seems to be", age);
        return age;
    }

    function checkIfExpired(lastModificationTime) {
        let res = getAge(lastModificationTime) > rotationInterval;
        logger.debug("expired", res);
        return res;
    }

    let self = this;

    function tic() {
        fs.stat(getPath(CURRENT_ENCRYPTION_KEY_FILE), (err, stats) => {
            if (stats && checkIfExpired(stats.mtime)) {
                self.rotate();
            }

            if (err || !stats) {
                //for any error we try as soon as possible again
                setTimeout(tic, 0);
            }
        });
    }

    function generateKey() {
        logger.debug("generating new key");
        return crypto.generateRandom(32);
    }

    this.init = () => {
        let stats;
        try {
            stats = fs.statSync(getPath(CURRENT_ENCRYPTION_KEY_FILE));
            if (stats) {
                logger.debug("mtime of current encryption key is", stats.mtime);
                if (checkIfExpired(stats.mtime)) {
                    throw new Error("Current key is to old");
                }
                logger.info("Loading encryption keys");
                current = fs.readFileSync(getPath(CURRENT_ENCRYPTION_KEY_FILE));
                try {
                    previous = fs.readFileSync(getPath(PREVIOUS_ENCRYPTION_KEY_FILE));
                } catch (e) {
                    logger.debug("Caught an error during previous key loading. This could mean that a restart was performed before any rotation and the previous key file doesn't exit.", e.message, e.code);
                }

                // let's schedule a quick check of key age
                setTimeout(tic, getAge(stats.mtime));
            } else {
                logger.info("Initializing...");
                throw new Error("Initialization required");
            }
        } catch (e) {
            logger.debug(e.message);
            //for any reason we try to ensure folder structure...
            fs.mkdirSync(storage, {recursive: true});

            this.rotate();
        }

        //we split the "big" interval in smaller intervals
        setInterval(tic, Math.round(rotationInterval / 12));
    }

    this.getCurrentEncryptionKey = () => {
        return current;
    }

    this.getPreviousEncryptionKey = () => {
        return previous;
    }

    this.rotate = () => {
        if (!current && !previous) {
            logger.info("No current or previous key, there we generate current ant persist");
            current = generateKey();
            return persist(CURRENT_ENCRYPTION_KEY_FILE, current, (err) => {
                if (err) {
                    logger.error("Failed to persist key");
                }
            });
        }
        logger.debug("saving current key as previous");
        previous = current;
        current = generateKey();

        function saveState(lastGeneratedKey) {
            if (lastGeneratedKey !== current) {
                logger.error("Unable to persist keys until a new rotation time achieved");
                //we weren't able to save the state until a new rotation
                return;
            }
            persist(PREVIOUS_ENCRYPTION_KEY_FILE, previous, (err) => {
                if (err) {
                    logger.debug("Caught error during key rotation", err);
                    return saveState(lastGeneratedKey);
                }
                persist(CURRENT_ENCRYPTION_KEY_FILE, current, (err) => {
                    if (err) {
                        logger.debug("Caught error during key rotation", err);
                        saveState(lastGeneratedKey);
                    }
                    logger.info("Successful key rotation");
                });
            });
        }

        saveState(current);
    }

    this.init();
    return this;
}

let keyManager;

function initializeKeyManager(storage, rotationInterval) {
    if (!keyManager) {
        keyManager = new KeyManager(storage, rotationInterval);
    }
}

function pkce() {
    const codeVerifier = crypto.generateRandom(32).toString('hex');
    const codeChallenge = pkceChallenge(codeVerifier);
    return {codeVerifier, codeChallenge};
}

function pkceChallenge(codeVerifier) {
    return crypto.sha256JOSE(codeVerifier).toString("base64").replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function urlEncodeForm(obj) {
    let encodedStr = "";
    for (let prop in obj) {
        encodedStr += `${encodeURIComponent(prop)}=${encodeURIComponent(obj[prop])}&`;
    }
    if (encodedStr[encodedStr.length - 1] === "&") {
        encodedStr = encodedStr.slice(0, -1);
    }

    return encodedStr;
}

function encodeCookie(cookie) {
    if (typeof cookie === "string") {
        cookie = $$.Buffer.from(cookie);
    }
    return encodeURIComponent(cookie.toString("base64"));
}

function decodeCookie(cookie) {
    return $$.Buffer.from(decodeURIComponent(cookie), "base64");
}

function parseCookies(cookies) {
    const parsedCookies = {};
    if (!cookies) {
        return parsedCookies;
    }
    let splitCookies = cookies.split(";");
    splitCookies = splitCookies.map(splitCookie => splitCookie.trim());
    splitCookies.forEach(cookie => {
        const cookieComponents = cookie.split("=");
        const cookieName = cookieComponents[0].trim();
        let cookieValue = cookieComponents[1].trim();
        if (cookieValue === "null" || cookieValue === "undefined") {
            cookieValue = undefined;
        }
        parsedCookies[cookieName] = cookieValue;
    })

    return parsedCookies;
}

function parseAccessToken(rawAccessToken) {
    let [header, payload, signature] = rawAccessToken.split(".");
    header = JSON.parse($$.Buffer.from(header, "base64").toString())
    payload = JSON.parse($$.Buffer.from(payload, "base64").toString())
    return {
        header, payload, signature
    }
}

function getCurrentEncryptionKey(callback) {
    if (!keyManager) {
        return callback(new Error("keyManager not instantiated"));
    }

    return callback(undefined, keyManager.getCurrentEncryptionKey());
}

function getPreviousEncryptionKey(callback) {
    if (!keyManager) {
        return callback(new Error("keyManager not instantiated"));
    }

    return callback(undefined, keyManager.getPreviousEncryptionKey());
}

const SSODetectedIdsAndUserIds = {};

function encryptTokenSet(tokenSet, callback) {
    delete SSODetectedIdsAndUserIds[tokenSet.access_token];
    getSSODetectedIdAndUserId(tokenSet, (err, {SSODetectedId}) => {
        if (err) {
            return callback(err);
        }

        const accessTokenPayload = {
            date: Date.now(),
            token: tokenSet.access_token,
            SSODetectedId
        }

        const refreshTokenPayload = {
            date: Date.now(),
            token: tokenSet.refresh_token
        }


        getCurrentEncryptionKey((err, encryptionKey) => {
            if (err) {
                return callback(err);
            }

            let encryptedTokenSet;
            try {
                let encryptedAccessToken = crypto.encrypt(JSON.stringify(accessTokenPayload), encryptionKey);
                let encryptedRefreshToken = crypto.encrypt(JSON.stringify(refreshTokenPayload), encryptionKey);
                encryptedTokenSet = {
                    encryptedAccessToken: encodeCookie(encryptedAccessToken),
                    encryptedRefreshToken: encodeCookie(encryptedRefreshToken)
                }
            } catch (e) {
                return callback(e);
            }
            callback(undefined, encryptedTokenSet);
        })
    })
}

function encryptLoginInfo(loginInfo, callback) {
    getCurrentEncryptionKey((err, encryptionKey) => {
        if (err) {
            return callback(err);
        }

        let encryptedContext;
        try {
            encryptedContext = crypto.encrypt(JSON.stringify(loginInfo), encryptionKey);
            encryptedContext = encodeCookie(encryptedContext);
        } catch (e) {
            return callback(e);
        }
        callback(undefined, encryptedContext);
    })
}

function encryptAccessToken(accessToken, SSODetectedId, callback) {
    const accessTokenTimestamp = Date.now();
    const accessTokenPayload = {
        date: accessTokenTimestamp, token: accessToken, SSODetectedId
    }

    getCurrentEncryptionKey((err, currentEncryptionKey) => {
        if (err) {
            return callback(err);
        }

        let encryptedAccessToken;
        try {
            encryptedAccessToken = crypto.encrypt(JSON.stringify(accessTokenPayload), currentEncryptionKey);
            encryptedAccessToken = encodeCookie(encryptedAccessToken);
        } catch (e) {
            return callback(e);
        }
        callback(undefined, encryptedAccessToken);
    });
}

function decryptData(encryptedData, encryptionKey, callback) {
    let plainData;
    try {
        plainData = crypto.decrypt(encryptedData, encryptionKey);
    } catch (e) {
        return callback(e);
    }

    callback(undefined, plainData);
}

function decryptDataWithCurrentKey(encryptedData, callback) {
    getCurrentEncryptionKey((err, currentEncryptionKey) => {
        if (err) {
            return callback(err);
        }

        decryptData(encryptedData, currentEncryptionKey, callback);
    })
}

function decryptDataWithPreviousKey(encryptedData, callback) {
    getPreviousEncryptionKey((err, previousEncryptionKey) => {
        if (err) {
            return callback(err);
        }

        decryptData(encryptedData, previousEncryptionKey, callback);
    })
}

function decryptAccessTokenCookie(accessTokenCookie, callback) {
    function parseAccessTokenCookie(accessTokenCookie, callback) {
        let parsedAccessTokenCookie;
        try {
            parsedAccessTokenCookie = JSON.parse(accessTokenCookie.toString());
        } catch (e) {
            return callback(e);
        }

        callback(undefined, parsedAccessTokenCookie);
    }

    decryptDataWithCurrentKey(decodeCookie(accessTokenCookie), (err, plainAccessTokenCookie) => {
        if (err) {
            decryptDataWithPreviousKey(decodeCookie(accessTokenCookie), (err, plainAccessTokenCookie) => {
                if (err) {
                    return callback(err);
                }

                parseAccessTokenCookie(plainAccessTokenCookie, callback);
            })

            return;
        }


        parseAccessTokenCookie(plainAccessTokenCookie, callback);
    })
}

function getSSODetectedIdFromPayload(obj) {
    return obj.email || obj.preferred_username || obj.upn || obj.sub;
}

function getSSODetectedIdAndUserId(tokenSet, callback) {
    let parsedToken;
    let payload;
    const cachedSSODetectedIdObj = SSODetectedIdsAndUserIds[tokenSet.access_token];
    if (cachedSSODetectedIdObj) {
        return callback(undefined, cachedSSODetectedIdObj);
    }
    try {
        parsedToken = parseAccessToken(tokenSet.id_token);
        payload = parsedToken.payload;
        const res = {
            SSOUserId: payload.sub,
            SSODetectedId: getSSODetectedIdFromPayload(payload)
        }
        SSODetectedIdsAndUserIds[tokenSet.access_token] = res;
        return callback(undefined, res);
    } catch (e) {
        const config = require("../../../http-wrapper/config");
        const oauthConfig = config.getConfig("oauthConfig");
        const WebClient = require("./WebClient");
        const webClient = new WebClient(oauthConfig);
        webClient.getUserInfo(tokenSet.access_token, (err, userInfo) => {
            if (err) {
                return callback(err);
            }

            const res = {
                SSOUserId: userInfo.sub,
                SSODetectedId: getSSODetectedIdFromPayload(userInfo)
            }
            SSODetectedIdsAndUserIds[tokenSet.access_token] = res;
            return callback(undefined, res);
        })
    }
}

function getSSODetectedIdFromEncryptedToken(accessTokenCookie, callback) {
    decryptAccessTokenCookie(accessTokenCookie, (err, decryptedAccessTokenCookie) => {
        if (err) {
            return callback(err);
        }

        return callback(undefined, decryptedAccessTokenCookie.SSODetectedId);
    })
}

function decryptRefreshTokenCookie(encryptedRefreshToken, callback) {
    if (!encryptedRefreshToken) {
        return callback(Error(errorMessages.REFRESH_TOKEN_UNDEFINED));
    }

    decryptDataWithCurrentKey(encryptedRefreshToken, (err, refreshToken) => {
        if (err) {
            decryptDataWithPreviousKey(encryptedRefreshToken, (err, refreshToken) => {
                if (err) {
                    err.message = errorMessages.REFRESH_TOKEN_DECRYPTION_FAILED;
                    return callback(err);
                }

                callback(undefined, refreshToken.toString());
            });
            return
        }

        callback(undefined, refreshToken.toString());
    });
}

function getPublicKeyFromJWKSEndpoint(jwksEndpoint, accessToken, callback) {
    http.doGet(jwksEndpoint, (err, rawData) => {
        if (err) {
            return callback(err);
        }

        let parsedData;
        try {
            parsedData = JSON.parse(rawData);
        } catch (e) {
            return callback(e);
        }

        const parsedAccessToken = parseAccessToken(accessToken);
        publicKey = parsedData.keys.find(key => key.use === "sig" && key.kid === parsedAccessToken.header.kid);
        if (!publicKey) {
            return callback(Error(`Could not get public key for the provided token's signature verification.`))
        }

        callback(undefined, publicKey);
    })
}

function getPublicKey(jwksEndpoint, rawAccessToken, callback) {
    if (publicKey) {
        return callback(undefined, publicKey);
    }

    getPublicKeyFromJWKSEndpoint(jwksEndpoint, rawAccessToken, callback);
}

function validateAccessToken(jwksEndpoint, accessToken, callback) {
    getPublicKey(jwksEndpoint, accessToken, (err, publicKey) => {
        if (err) {
            return callback(err);
        }

        crypto.jsonWebTokenAPI.verify(accessToken, publicKey, (err, verified) => {
            if (err || !verified) {
                getPublicKeyFromJWKSEndpoint(jwksEndpoint, accessToken, (err, publicKey) => {
                    if (err) {
                        return callback(err);
                    }

                    crypto.jsonWebTokenAPI.verify(accessToken, publicKey, callback);
                });

                return;
            }

            callback();
        });
    })
}

function validateEncryptedAccessToken(jwksEndpoint, accessTokenCookie, sessionTimeout, callback) {
    decryptAccessTokenCookie(accessTokenCookie, (err, decryptedAccessTokenCookie) => {
        if (err) {
            return callback(Error(errorMessages.ACCESS_TOKEN_DECRYPTION_FAILED));
        }

        if (Date.now() - decryptedAccessTokenCookie.date > sessionTimeout) {
            return callback(Error(errorMessages.SESSION_EXPIRED));
        }
        callback();
        // validateAccessToken(jwksEndpoint, decryptedAccessTokenCookie.token, callback);
    })
}

function decryptLoginInfo(encryptedLoginInfo, callback) {
    decryptDataWithCurrentKey(decodeCookie(encryptedLoginInfo), (err, loginContext) => {
        function parseLoginContext(loginContext, callback) {
            let parsedLoginContext;
            try {
                parsedLoginContext = JSON.parse(loginContext.toString());
            } catch (e) {
                return callback(e);
            }

            callback(undefined, parsedLoginContext);
        }

        if (err) {
            decryptDataWithPreviousKey(decodeCookie(encryptedLoginInfo), (err, loginContext) => {
                if (err) {
                    return callback(err);
                }

                parseLoginContext(loginContext, callback);
            })

            return;
        }

        parseLoginContext(loginContext, callback);
    })
}

function getUrlsToSkip() {
    const config = require("../../../http-wrapper/config");
    const skipOAuth = config.getConfig("skipOAuth");
    let urlsToSkip = skipOAuth && Array.isArray(skipOAuth) ? skipOAuth : [];
    const configuredDomains = config.getConfiguredDomains();
    configuredDomains.forEach(domain => {
        const domainConfig = config.getDomainConfig(domain);
        if (domainConfig.skipOAuth) {
            urlsToSkip = urlsToSkip.concat(domainConfig.skipOAuth);
        }
    })

    return urlsToSkip;
}

function updateAccessTokenExpiration(accessTokenCookie, callback) {
    decryptAccessTokenCookie(accessTokenCookie, (err, decryptedTokenCookie) => {
        if (err) {
            return callback(err);
        }

        encryptAccessToken(decryptedTokenCookie.token, decryptedTokenCookie.SSODetectedId, callback);
    })
}

function printDebugLog(...args) {
    const config = require("../../../http-wrapper/config");
    const oauthConfig = config.getConfig("oauthConfig");
    if (oauthConfig.debugLogEnabled) {
        logger.debug(...args);
    }
}

module.exports = {
    pkce,
    urlEncodeForm,
    parseCookies,
    initializeKeyManager,
    parseAccessToken,
    encryptTokenSet,
    encryptLoginInfo,
    decryptLoginInfo,
    decryptRefreshTokenCookie,
    getPublicKey,
    validateAccessToken,
    validateEncryptedAccessToken,
    getUrlsToSkip,
    getSSODetectedIdAndUserId,
    getSSODetectedIdFromEncryptedToken,
    updateAccessTokenExpiration,
    printDebugLog,
    getSSODetectedIdFromPayload
}
