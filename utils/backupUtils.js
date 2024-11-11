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

module.exports = {
    notifyBackup
};