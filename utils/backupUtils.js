const fs = require('fs');
const path = require('path');
const serverConfig = require('../config').getConfig();
const backupJournalFilePath = serverConfig.backupJournalFilePath || path.join(serverConfig.storage, "external-volume", "backup", "backup-journal.txt");
const notifyBackup = (filePath) => {
    fs.mkdirSync(path.dirname(backupJournalFilePath), {recursive: true});
    fs.appendFile(backupJournalFilePath, `${filePath}\n`, (err) => {
        if (err) {
            console.error(`Failed to add file path to backup request: ${filePath}`);
            return;
        }
        console.log(`File path added to backup request: ${filePath}`);
    });
};

const restoreFileFromBackup = (backupServiceUrl, filePath, callback) => {
    const http = require("opendsu").loadAPI("http");
    const fileUrl = `${backupServiceUrl}/getFile/${encodeURIComponent(filePath)}`;
    http.fetch(fileUrl).then(async (response) => {
        if (response.status !== 200) {
            callback(new Error(`Failed to fetch file from backup service: ${fileUrl}`));
            return;
        }
        let fileContent = await response.arrayBuffer();
        fileContent = $$.Buffer.from(fileContent);
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
        fs.writeFile(filePath, fileContent, callback);
    }).catch((err) => {
        console.error(`Failed to fetch file from backup service: ${fileUrl}`, err);
        callback(err);
    });
}

module.exports = {
    notifyBackup,
    restoreFileFromBackup
};