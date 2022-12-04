/********************************************************************************
 * Copyright (C) 2022 CoCreate LLC and others.
 *
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/
 const express = require('express');
 const router = express.Router();
 const mime = require('mime-types');
 const dns = require('dns');
 
class CoCreateFileSystem {
    constructor(crud, render) {
        this.router = router.get('/*', async(req, res) => {
            let organization_id;
            let hostname = req.hostname;
            // dns.resolve(hostname, 'TXT', (err, records) => {
            //     if (records)
            //         organization_id = records[0][0];
            //     if (err)
            //         console.log(hostname, err);
            // });
        
            if (!organization_id) {
                let organization = await crud.readDocument({ 
                    collection: 'organizations',
                    filter: {
                        query: [
                            {name: "domains", value: hostname, operator: "$includes"}
                        ]
                    }

                })
                if (!organization || !organization.document[0])
                    return res.send('Organization cannot be found using the domain: ' + hostname + ' in platformDB: ' + masterOrg);
                
                console.log('file-server-----????', organization.document[0], organization_id, organization_id)

                organization_id = organization.document[0]._id
            }
            console.log('file-server-----????', organization_id)

            let [url, parameters] = req.url.split("?");
            if (parameters){}
            if (url.endsWith('/')) {
                url += "index.html";
            }
            else {
                let directory = url.split("/").slice(-1)[0];
                if (!directory.includes('.')){
                    url += "/index.html";
                }
            }
        
            url = url.startsWith('/ws') ? url.substr(3) : url; // dev
            
            // fix: '*' causing error 'must be a single String of 12 bytes or a string of 24 hex characters'
            let file = await crud.readDocument({
                collection: 'files',
                filter: {
                    query: [
                        {name: "domains", value: [hostname, '*'], operator: "$includes"},
                        {name: "path", value: url, operator: "$includes"}
                    ]
                },
                organization_id
            });
        
            if (!file || !file.document || !file.document[0])
                return res.status(404).send(`${url} could not be found for ${organization_id} `);
            
            file = file.document[0]
            if (!file['public'] ||  file['public'] === "false")
                return res.status(404).send(`access not allowed`);
        
            let src;
            if (file['src'])
                src = file['src'];
            else {
                let fileSrc = await crud.readDocument({
                    collection: file['collection'],
                    document: {
                        _id: file._id
                    },
                    organization_id
                });
                src = fileSrc[file['name']];
            }
        
            if (!src) {
                res.send('Document provided by routes could not be found and has no src ');
            }
        
            let content_type = file['content_type'] || mime.lookup(url) || 'text/html';
        
            if (content_type.startsWith('image/') || content_type.startsWith('audio/') || content_type.startsWith('video/')) {
                var base64Data = src.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
                let file = Buffer.from(base64Data, 'base64');
                res.writeHead(200, {
                'Content-Type': content_type,
                'Content-Length': file.length
                });
                res.end(file);
            }
            else if (content_type === 'text/html') {
                try {
                    let fullHtml = await render.html(orgDB, src);
                    res.type(content_type);
                    res.send(fullHtml);
                }
                catch (err) {
                    if (err.message.startsWith('infinite loop:')) {
                        console.log('infinte loop ')
                        return res.send('there is a infinite loop');
        
                    }
                    else {
                        console.warn('something is wrong with server-rendering: ' + err.message)
                        return res.send(src + `<script>console.log("${'something is wrong with server-rendering: ' + err.message}")</script>`)
                    }
                }
        
            }
            else {
                res.type(content_type);
                res.send(src);
            }
        
        })
    
    }	
}

module.exports = CoCreateFileSystem;
 