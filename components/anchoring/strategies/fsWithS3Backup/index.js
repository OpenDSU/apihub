const S3 = require('../s3');
const FS = require('../fs');

function FsWithS3Backup(server, domainConfig, anchorId, anchorValue, jsonData) {
    const fsStrategy = new FS(server, domainConfig, anchorId, anchorValue, jsonData);
    const s3Strategy = new S3(server, domainConfig, anchorId, anchorValue, jsonData);

    const backupToS3 = (action) => {
        s3Strategy[action]((err, result) => {
            if (err) {
                console.error(`Error backing up ${action} to S3:`, err);
            } else {
                console.log(`${action} successfully backed up to S3.`, result);
            }
        });
    };

    this.createAnchor = (callback) => {
        fsStrategy.createAnchor((err, result) => {
            if (err) {
                console.error("Error creating anchor in FS:", err);
                // Fall back to S3 if FS fails
                s3Strategy.createAnchor(callback);
            } else {
                // Asynchronously back up to S3
                backupToS3('createAnchor');
                callback(undefined, result);
            }
        });
    };

    this.appendAnchor = (callback) => {
        fsStrategy.appendAnchor((err, result) => {
            if (err) {
                console.error("Error appending anchor in FS:", err);
                // Fall back to S3 if FS fails
                s3Strategy.appendAnchor(callback);
            } else {
                // Asynchronously back up to S3
                backupToS3('appendAnchor');
                callback(undefined, result);
            }
        });
    };

    this.getAllVersions = (callback) => {
        fsStrategy.getAllVersions((err, anchorValues) => {
            if (err || anchorValues.length === 0) {
                console.error("Error retrieving all versions from FS or anchor not found:", err);
                // Fall back to S3 if FS fails or no versions found
                s3Strategy.getAllVersions(callback);
            } else {
                callback(undefined, anchorValues);
            }
        });
    };

    this.getLastVersion = (callback) => {
        fsStrategy.getLastVersion((err, anchorValue) => {
            if (err || !anchorValue) {
                console.error("Error retrieving last version from FS or anchor not found:", err);
                // Fall back to S3 if FS fails or last version not found
                s3Strategy.getLastVersion(callback);
            } else {
                callback(undefined, anchorValue);
            }
        });
    };
}

module.exports = FsWithS3Backup;
