const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const querystring = require('querystring');
const cookieUtils = require("../../http-wrapper/utils/cookie-utils");
const SecretsService = require("../../components/secrets/SecretsService");
const appName = 'simpleAuth'
const PUT_SECRETS_URL_PATH = "/putSSOSecret/simpleAuth";
const GET_SECRETS_URL_PATH = "/getSSOSecret/simpleAuth";
const API_KEY_CONTAINER_NAME = "apiKeys";

// Utility function to read .htpassword.secrets file
function readSecretsFile(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        let userEntries = data.split('\n').filter(function (item) {
            //remove empty results
            return item !== "";
        });
        return userEntries;
    } catch (err) {
        // console.error(err);
        return null;
    }
}

function getSSOId(mail) {
    if (mail) {
        return mail;
    }
    return crypto.generateRandom(32).toString("base64");
}

function getPwdSecret(user, pwd, mail, ssoId) {
    let secret = `${user}:${pwd}:${mail}`;

    if (ssoId) {
        secret = `${secret}:${ssoId}`
    }

    return secret;
}

// SimpleAuthentication Middleware
module.exports = function (server) {
    const serverRootFolder = server.rootFolder;
    const secretsFilePath = path.join(serverRootFolder, '.htpassword.secret');
    const htpPwdSecrets = readSecretsFile(secretsFilePath);
    const skipUrls = ['/simpleAuth', '/simpleAuth?wrongCredentials=true', '/favicon.ico', '/redirect', GET_SECRETS_URL_PATH, PUT_SECRETS_URL_PATH, "/logout", "/customSimpleAuth", "/bdns"];
    const util = require("../oauth/lib/util.js");
    const urlsToSkip = [...util.getUrlsToSkip(), ...skipUrls];
    let secretsService;
    setTimeout(async () => {
        secretsService = await SecretsService.getSecretsServiceInstanceAsync(server.rootFolder);
    });

    const logger = $$.getLogger("simpleAuth", "apihub/simpleAuth");
    logger.info("SimpleAuth is active");
    logger.info("To customize SimpleAuth pages create apihub-root/customSimpleAuth folder.");

    server.use(function (req, res, next) {
        if (!fs.existsSync(secretsFilePath)) {
            return next();
        }

        if (!htpPwdSecrets) {
            return res.writeHead(500).end('Error reading secrets file');
        }

        const canSkipOAuth = urlsToSkip.some((urlToSkip) => req.url.indexOf(urlToSkip) !== -1);
        if (canSkipOAuth) {
            return next();
        }

        if (req.headers.authorization) {
            const [username, password] = req.headers.authorization.split(" ")[1].split(":");
            const index = htpPwdSecrets.findIndex(entry => entry.startsWith(username));
            const splitSecrets = htpPwdSecrets[index].split(':');
            const pwd = splitSecrets[1];
            const ssoId = splitSecrets[3];
            if (pwd === password) {
                req.headers["user-id"] = ssoId;
                return next();
            }
        }

        let {SimpleAuthorisation} = cookieUtils.parseCookies(req.headers.cookie);

        if (!SimpleAuthorisation) {
            if (req.skipSSO) {
                return next();
            }
            res.setHeader('Set-Cookie', `originalUrl=${req.url}; HttpOnly`);
            return res.writeHead(302, {'Location': '/simpleAuth'}).end();
        }

        // Verify API Key
        const authorisationData = SimpleAuthorisation.split(":");

        if (authorisationData.length !== 2 || !secretsService.getSecretSync(appName, authorisationData[0])) {
            res.writeHead(302, {'Location': '/simpleAuth'});
            //    res.setHeader('Set-Cookie', 'SimpleAuthorisation=; HttpOnly; Max-Age=0');
            return res.end();
        }

        const index = htpPwdSecrets.findIndex(entry => entry.startsWith(authorisationData[0]));
        const splitSecrets = htpPwdSecrets[index].split(':');
        req.headers["user-id"] = splitSecrets[3];
        next();
    });

    const httpUtils = require("../../http-wrapper/src/httpUtils");

    server.get('/simpleAuth/*', (req, res) => {
        let wrongCredentials = req.query.wrongCredentials || false;
        res.writeHead(200, {'Content-Type': 'text/html'});
        const errHtml = `<div id="err-container">${wrongCredentials ? "Invalid username or password" : ""}</div>`
        let returnHtml = `
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login Page</title>
             <style>
             #form-container{
                 width: fit-content;
                 margin: auto;
                 text-align: center;
             }
             form div{
                 display: flex;
                 justify-content: space-between;
                 gap: 10px;
             }
             #err-container{
                 color: red;
             }
             </style>
        </head>
        <body>
        <div id="form-container">
            <h2>Login</h2>
            <form action="/simpleAuth" method="post">
               <div> <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
               </div>
               <br>
               <div>
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
               </div>
                <br>
                <button type="submit">Submit</button>
            </form>
            ${errHtml}
            </div>

        </body>
        </html>
`
        let customizedHtmlExists = false;
        try {
            let path = require("path");
            const file = wrongCredentials ? "error.html" : "index.html";
            customizedHtmlExists = fs.readFileSync(path.join(server.rootFolder, 'customSimpleAuth', file));
        } catch (err) {
            //we ignore the error on purpose
        }
        if (customizedHtmlExists) {
            return res.end(customizedHtmlExists);
        }
        return res.end(returnHtml);
    })

    const simpleAuthHandler = async (req, res) => {
        const {body} = req;
        const formResult = querystring.parse(body);
        const hashedPassword = crypto.sha256JOSE(formResult.password).toString("hex");
        const index = htpPwdSecrets.findIndex(entry => entry.startsWith(formResult.username));
        if (index === -1) {
            res.writeHead(302, {'Location': '/simpleAuth?wrongCredentials=true'});
            return res.end();
        }

        let [user, pwd, mail, ssoId] = htpPwdSecrets[index].split(':');
        if (pwd === hashedPassword) {
            if (!ssoId) {
                ssoId = getSSOId(mail);
                htpPwdSecrets[index] = getPwdSecret(user, pwd, mail, ssoId)
                // Join the entries back into a single string
                const updatedData = htpPwdSecrets.join('\n');
                try {
                    await fsPromises.writeFile(secretsFilePath, updatedData, 'utf8');
                } catch (e) {
                    console.error(e);
                    res.statusCode = 500;
                    return res.end(`Fail`);
                }
            }
            let apiKey;
            try {
                let apiKeyObj = secretsService.getSecretSync(API_KEY_CONTAINER_NAME, formResult.username);
                if (apiKeyObj) {
                    apiKey = apiKeyObj.secret;
                }
            } catch (e) {
                console.error(e);
            }
            try {
                if (!apiKey) {
                    apiKey = await secretsService.generateAPIKeyAsync(formResult.username, false);
                    await secretsService.putSecretAsync(appName, formResult.username, apiKey);
                }
            } catch (e) {
                console.error(e);
                res.statusCode = 500;
                return res.end(`Error writing secret`);
            }
            res.setHeader('Set-Cookie', [`SimpleAuthorisation=${formResult.username}:${apiKey}; HttpOnly`, `ssoId=${ssoId}; HttpOnly`, `apiKey=${apiKey}; HttpOnly`]);
            res.writeHead(302, {'Location': '/redirect'});
            return res.end();
        } else {
            res.writeHead(302, {'Location': '/simpleAuth?wrongCredentials=true'});
            return res.end();
        }
    };


    server.get('/redirect', (req, res) => {
        let {originalUrl, ssoId} = cookieUtils.parseCookies(req.headers.cookie);
        res.setHeader('Set-Cookie', ['originalUrl=; HttpOnly; Max-Age=0', 'ssoId=; HttpOnly; Max-Age=0']);
        res.writeHead(200, {'Content-Type': 'text/html'});

        return res.end(`<script>localStorage.setItem('SSODetectedId', '${ssoId}'); window.location.href = '${originalUrl || "/"}';</script>`);
    });

    server.post('/simpleAuth', httpUtils.bodyParser);
    server.post('/simpleAuth', simpleAuthHandler)

    server.put('/simpleAuth', httpUtils.bodyParser);
    server.put('/simpleAuth', simpleAuthHandler);

    server.get('/logout', (req, res) => {
        res.setHeader('Set-Cookie', [`SimpleAuthorisation=; HttpOnly`]);
        res.writeHead(302, {'Location': '/'});
        return res.end();
    });

    server.whitelistUrlForSessionTimeout = (url) => {
    };

    server.whitelistUrl = (url) => {
        if (url.startsWith("/")) {
            urlsToSkip.push(url);
        } else {
            throw new Error(`Whitelisting invalid URL: ${url}. It should start with /`);
        }
    };
}
