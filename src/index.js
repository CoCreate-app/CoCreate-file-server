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
                            {name: "hosts", value: [hostname], operator: "$in"}
                        ]
                    },
                    organization_id: process.env.organization_id
                })
                if (!organization || !organization.document || !organization.document[0])
                    return res.send('Organization cannot be found using the host: ' + hostname + ' in platformDB: ' + process.env.organization_id);

                organization_id = organization.document[0]._id
            }

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
        
            url = url.startsWith('/ws') ? url.substring(3) : url; // dev
            
            let file = await crud.readDocument({
                collection: 'files',
                filter: {
                    query: [
                        {name: "hosts", value: [hostname, '*'], operator: "$in"},
                        {name: "path", value: url, operator: "$eq"}
                    ]
                },
                organization_id
            });
        
            if (!file || !file.document || !file.document[0])
                return res.status(404).send(`${url} could not be found for ${organization_id}`);
            
            file = file.document[0]
            if (!file['public'] || file['public'] === "false")
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
        
            if (!src)
                return res.status(404).send(`src could not be found`);
        
            let contentType = file['content-type'] || mime.lookup(url) || 'text/html';

            if (contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/')) {
                src = src.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
                src = Buffer.from(src, 'base64');
            } else if (contentType === 'text/html') {
                try {
                    src = await render.HTML(src, organization_id);
                } catch (err) {
                    console.warn('server-render: ' + err.message)
                }
            } 

            return res.type(contentType).send(src);
        
        })
    
    }	
}

module.exports = CoCreateFileSystem;
 