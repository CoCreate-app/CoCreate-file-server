/********************************************************************************
 * Copyright (C) 2022 CoCreate LLC and others.
 *
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/
const express = require('express');
const router = express.Router();
const mime = require('mime-types');
const organizations = new Map();

class CoCreateFileSystem {
    constructor(crud, render) {
        
        async function defaultFiles(fileName) {
            let file = await crud.readDocument({ 
                collection: 'files',
                filter: {
                    query: [
                        {name: "path", value: fileName, operator: "$eq"}
                    ]
                },
                organization_id: process.env.organization_id
            })
            if (!file || !file.document || !file.document[0])
                return ''
            return file.document[0].src
        }

        let default403, default404, hostNotFound
        defaultFiles('/403.html').then((file) => {
            default403 = file
        })
        defaultFiles('/404.html').then((file) => {
            default404 = file
        })
        defaultFiles('/hostNotFound.html').then((file) => {
            hostNotFound = file
        })

        this.router = router.get('/*', async(req, res) => {
            let hostname = req.hostname;
            let organization_id = organizations.get(hostname);
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

                if (!organization || !organization.document || !organization.document[0]) {
                    hostNotFound = hostNotFound || 'Organization cannot be found using the host: ' + hostname + ' in platformDB: ' + process.env.organization_id 
                    return res.send(hostNotFound);
                }

                organization_id = organization.document[0]._id
                organizations.set(hostname, organization_id)
            }

            let [url, parameters] = req.url.split("?");
            if (parameters){}
            if (url.endsWith('/')) {
                url += "index.html";
            } else {
                let directory = url.split("/").slice(-1)[0];
                if (!directory.includes('.')){
                    url += "/index.html";
                }
            }
                    
            let data = {
                collection: 'files',
                filter: {
                    query: [
                        {name: "hosts", value: [hostname, '*'], operator: "$in"},
                        {name: "path", value: url, operator: "$eq"}
                    ]
                },
                organization_id
            }

            if (url.startsWith('/superadmin')) 
                data.organization_id = process.env.organization_id

            let file = await crud.readDocument(data);
        
            if (!file || !file.document || !file.document[0]) {
                data.filter.query[1].value = '/404.html'
                if (data.organization_id !== organization_id)
                    data.organization_id = organization_id

                let pageNotFound = await crud.readDocument(data); 
                if (!pageNotFound || !pageNotFound.document || !pageNotFound.document[0])
                    pageNotFound = default404 || `${url} could not be found for ${organization_id}`
                else 
                    pageNotFound = pageNotFound.document[0].src
                return res.status(404).send(pageNotFound);
            }

            file = file.document[0]
            if (!file['public'] || file['public'] === "false") {
                data.filter.query[1].value = '/403.html'
                if (data.organization_id !== organization_id)
                    data.organization_id = organization_id

                let pageForbidden = await crud.readDocument(data); 
                if (!pageForbidden || !pageForbidden.document || !pageForbidden.document[0])
                    pageForbidden = default403 || `${url} access not allowed for ${organization_id}`
                else 
                    pageForbidden = pageForbidden.document[0].src

                return res.status(403).send(pageForbidden);
            }
            
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
                data.filter.query[1].value = '/404.html'
                if (data.organization_id !== organization_id)
                    data.organization_id = organization_id

                let pageNotFound = await crud.readDocument(data); 
                if (!pageNotFound || !pageNotFound.document || !pageNotFound.document[0])
                    pageNotFound = `${url} could not be found for ${organization_id}` 
                return res.status(404).send(pageNotFound);
            }
        
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
            if (url.startsWith('/superadmin')) {
                let apikey = "e968b3a6-435e-4d79-a251-b41d7d08"
                src = src.replace('5ff747727005da1c272740ab', organization_id).replace('2061acef-0451-4545-f754-60cf8160', apikey)
                console.log('getapikey superadmin')
            }

            return res.type(contentType).send(src);
        
        })
    
    }	
}

module.exports = CoCreateFileSystem;
 