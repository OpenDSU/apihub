const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const openDSU = require("opendsu");
const crypto = openDSU.loadAPI("crypto");
const querystring = require('querystring');
const util = require("../../utils/cookie-utils");
const SecretsService = require("../../components/secrets/SecretsService");
const appName = 'simpleAuth'
const PUT_SECRETS_URL_PATH = "/putSSOSecret/simpleAuth";
const GET_SECRETS_URL_PATH = "/getSSOSecret/simpleAuth";
const skipUrls = ['/simpleAuth', '/simpleAuth?wrongCredentials=true', '/favicon.ico', '/redirect', GET_SECRETS_URL_PATH, PUT_SECRETS_URL_PATH]

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
    let secretsService;
    setTimeout(async () => {
        secretsService = await SecretsService.getSecretsServiceInstanceAsync(server.rootFolder);
    });

    server.use(function (req, res, next) {
        if (!fs.existsSync(secretsFilePath)) {
            return next();
        }

        if (!htpPwdSecrets) {
            return res.writeHead(500).end('Error reading secrets file');
        }

        if (skipUrls.includes(req.url)) {
            return next();
        }

        let {SimpleAuthorisation} = util.parseCookies(req.headers.cookie);

        if (!SimpleAuthorisation) {
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

        next();
    });

    const httpUtils = require("../../libs/http-wrapper/src/httpUtils");

    server.get('/simpleAuth/*', (req, res) => {
        let wrongCredentials = req.query.wrongCredentials || false;
        res.writeHead(200, {'Content-Type': 'text/html'});
        const errHtml = `<div id="err-container">${wrongCredentials ? "Invalid username or password" : ""}</div>`
        const returnHtml = `
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
        return res.end(returnHtml);
    })

    server.post('/simpleAuth', httpUtils.bodyParser);
    server.post('/simpleAuth', async (req, res) => {
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
                    res.statusCode = 500;
                    return res.end(`Error writing file: ${e.message}`);
                }
            }
            let apiKey;
            try {
                apiKey = await secretsService.generateAPIKeyAsync(formResult.username, false);
                await secretsService.putSecretAsync(appName, formResult.username, apiKey);
            } catch (e) {
                res.statusCode = 500;
                return res.end(`Error writing secret: ${e.message}`);
            }
            res.setHeader('Set-Cookie', [`SimpleAuthorisation=${formResult.username}:${apiKey}; HttpOnly`, `ssoId=${ssoId}; HttpOnly`, `apiKey=${apiKey}; HttpOnly`]);
            res.writeHead(302, {'Location': '/redirect'});
            return res.end();
        }
    });


    server.get('/redirect', (req, res) => {
        let {originalUrl, ssoId} = util.parseCookies(req.headers.cookie);
        res.setHeader('Set-Cookie', ['originalUrl=; HttpOnly; Max-Age=0', 'ssoId=; HttpOnly; Max-Age=0']);
        res.writeHead(200, {'Content-Type': 'text/html'});

        return res.end(`<script>localStorage.setItem('SSODetectedID', '${ssoId}'); window.location.href = '${originalUrl || "/"}';</script>`);
    })
}
