import * as vscode from 'vscode';
import * as Utils from './utils';
import { EventEmitter } from 'events';
import * as request from 'request';
import * as path from 'path';
import * as fs from 'fs';

const SYNC_TIME_VARIANCE = 20000;

export class FileManager {
    public awsregion;
    public environmentId;
    public cookieJar;
    public xauth;

    constructor(
        private eventEmitter
    ) {
        this.awsregion = Utils.GetRegion();
    }

    recursiveDownload(startPath) {
        console.log("Performing lookup from " + startPath);
        return new Promise((resolve, reject) => {
            request.get({
                url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment' + startPath + "/",
                jar: this.cookieJar,
                headers: {
                    'Content-Type': 'text/plain',
                    'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                    'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                    'x-authorization': this.xauth
                }
            }, (err, httpResponse, body) => {
                Utils.ReducePromises(JSON.parse(body), (inode) => {
                    if (startPath + "/" + inode['name'] == "/.c9" || startPath + "/" + inode['name'] == "/.vscode") {
                        return Promise.resolve();
                    }
    
                    let inodePath = path.join(vscode.workspace.rootPath, startPath + "/" + inode['name']);
                    if (inode['mime'] == "inode/directory") {
                        if (!fs.existsSync(inodePath)){
                            console.log("Creating the directory " + inodePath);
                            fs.mkdirSync(inodePath);
                        }
                        return this.recursiveDownload(startPath + "/" + inode['name']);
                    } else {
                        if (fs.existsSync(inodePath)) {
                            let ftime = inode['mtime'];
                            let fstat = fs.statSync(inodePath);
                            let lftime = new Date(fstat['mtime']).getTime();
                            console.log(lftime);
                            console.log(ftime);
                            if (lftime + SYNC_TIME_VARIANCE > ftime) {
                                console.log(inodePath + " is up to date, skipping...");
                                return Promise.resolve();
                            }
                        }
                        return this.downloadFile(startPath + "/" + inode['name'], inodePath, inode);
                    }
                })
                .then(resolve, reject)
                .catch((err) => {
                    console.error(err);
                });
            });
        });
    }
    
    downloadFile(filename, inodePath, inode) {
        return new Promise((resolve, reject) => {
            request.get({
                url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment/' + filename,
                jar: this.cookieJar,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                    'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                    'x-authorization': this.xauth
                }
            }, function(err, httpResponse, body) {
                console.log("Creating the file " + inodePath);
                fs.writeFileSync(inodePath, body);
                //fs.utimes(inodePath, parseInt(inode.mtime/1000), parseInt(inode.mtime/1000), resolve); TODO: Fix
                resolve(); // REMOVE ME
            });
        });
    }

    uploadExistingFile(filename, content) {
        request.post({
            url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment/' + filename,
            jar: this.cookieJar,
            headers: {
                'Content-Type': 'text/plain',
                'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                'x-authorization': this.xauth
            },
            body: content
        }, function(err, httpResponse, body) {
            console.log(httpResponse);
            console.log(body);
        });
    }
    
    
    uploadRemoteFile(filename, content) {
        request.put({
            url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment/' + filename,
            jar: this.cookieJar,
            headers: {
                'Content-Type': 'text/plain',
                'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                'x-authorization': this.xauth
            },
            body: content
        }, function(err, httpResponse, body) {
            console.log(httpResponse);
            console.log(body);
        });
    }
    
    deleteRemoteFile(filename) {
        request.delete({
            url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment/' + filename,
            jar: this.cookieJar,
            headers: {
                'Content-Type': 'text/plain',
                'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                'x-authorization': this.xauth
            }
        }, function(err, httpResponse, body) {
            console.log(err);
            console.log(httpResponse);
            console.log(body);
        });
    }
    
    recursiveUpload(startPath) {
        console.log("Performing lookup from " + startPath);
        return new Promise((resolve, reject) => {
            let inodePath = path.join(vscode.workspace.rootPath, startPath + "/");

            request.get({
                url: 'https://vfs.cloud9.' + this.awsregion + '.amazonaws.com/vfs/' + this.environmentId + '/environment' + Utils.EnsureLeadingSlash(startPath) + "/",
                jar: this.cookieJar,
                headers: {
                    'Content-Type': 'text/plain',
                    'Origin': 'https://' + this.awsregion + '.console.aws.amazon.com',
                    'Referer': 'https://' + this.awsregion + '.console.aws.amazon.com/cloud9/ide/' + this.environmentId,
                    'x-authorization': this.xauth
                }
            }, (err, httpResponse, body) => {
                console.log("REMOTE STAT FOR UPLOAD");
                console.log(err);
                console.log(body);
                let remoteStats = [];
                try {
                    remoteStats = JSON.parse(body);
                    if ('error' in remoteStats) {
                        reject();
                    }
                } catch(err) {
                    console.log("Could not get remote stats");
                    console.log(body);
                    resolve();
                }
    
                console.log("About to do readdir on" + inodePath);
    
                fs.readdir(inodePath, (err, files) => {
                    if (err) reject(err);
    
                    console.log("Reading - " + inodePath);
                    console.log(files);
                    if (!files) {
                        console.log("No files, skipping...");
                        resolve();
                    }
                    
                    Utils.ReducePromises(files, (file) => {
                        let relativePath = path.join(startPath + "/", file);
                        console.log("Processing file: " + relativePath);
                        if (relativePath == "/.c9" || relativePath == "/.vscode" || relativePath == "/.git") {
                            return Promise.resolve();
                        }
    
                        return new Promise((resolve, reject) => {
                            var filepath = path.join(inodePath, file);
                            console.log("Beginning upload processing of " + filepath + " (" + relativePath + ")");
                            fs.stat(filepath, (err, fstat) => {
                                if (fstat.isDirectory()) {
                                    this.eventEmitter.emit('send_ch4_message',
                                        ["mkdir",relativePath,{},{"$":33}]
                                    );
                                    this.recursiveUpload(relativePath).then(function(){
                                        resolve();
                                    }).catch((err) => {
                                        console.error(err);
                                    });
                                } else if (fstat.isFile()) {
                                    let ftime = null;
                                    let lftime = new Date(fstat['mtime']).getTime();
    
                                    console.log("Checking remote stats now");
    
                                    remoteStats.forEach(remoteStat => {
                                        if (remoteStat.name == relativePath) {
                                            ftime = remoteStat.mtime;
                                        }
                                    });
                                    
                                    console.log("ftime: " + ftime);
                                    if (ftime == null) {
                                        console.log("Uploading new file");
                                        this.uploadRemoteFile(relativePath, fs.readFileSync(filepath));
                                    } else if (lftime > ftime + SYNC_TIME_VARIANCE) {
                                        console.log("Updating existing file");
                                        this.uploadExistingFile(relativePath, fs.readFileSync(filepath));
                                    }
    
                                    resolve();
                                } else {
                                    console.log("Unknown file type");
                                    resolve();
                                }
                            });
                        });
                    })
                    .then(resolve, reject)
                    .catch((err) => {
                        console.error(err);
                    });
                });
            });
        });
    }
}
