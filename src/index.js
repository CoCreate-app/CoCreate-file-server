/********************************************************************************
 * Copyright (C) 2022 CoCreate LLC and others.
 *
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/
const { URL } = require('url');

const organizations = new Map();

class CoCreateFileSystem {
    constructor(server, crud, render) {
        async function defaultFiles(fileName) {
            let file = await crud.send({
                method: 'read.object',
                array: 'files',
                filter: {
                    query: [
                        { key: "path", value: fileName, operator: "$eq" }
                    ]
                },
                organization_id: process.env.organization_id
            })
            if (!file || !file.object || !file.object[0])
                return ''
            return file.object[0].src
        }

        let default403, default404, hostNotFound, signup
        defaultFiles('/403.html').then((file) => {
            default403 = file
        })
        defaultFiles('/404.html').then((file) => {
            default404 = file
        })
        defaultFiles('/hostNotFound.html').then((file) => {
            hostNotFound = file
        })
        defaultFiles('/superadmin/signup.html').then((file) => {
            signup = file
        })

        server.on('request', async (req, res) => {
            try {
                const fileContent = req.headers['File-Content']
                if (fileContent) {
                    res.writeHead(200, { 'Content-Type': req.headers['Content-Type'] });
                    return res.end(fileContent);
                }

                const valideUrl = new URL(`http://${req.headers.host}${req.url}`);
                const hostname = valideUrl.hostname;

                let organization = organizations.get(hostname);
                if (!organization) {
                    let org = await crud.send({
                        method: 'read.object',
                        array: 'organizations',
                        filter: {
                            query: [
                                { key: "host", value: [hostname], operator: "$in" }
                            ]
                        },
                        organization_id: process.env.organization_id
                    })

                    if (!org || !org.object || !org.object[0]) {
                        hostNotFound = hostNotFound || 'An organization could not be found using the host: ' + hostname + ' in platformDB: ' + process.env.organization_id
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        return res.end(hostNotFound);
                    } else {
                        organization = { _id: org.object[0]._id }
                        organizations.set(hostname, organization)
                    }
                }

                let organization_id = organization._id
                res.setHeader('organization', organization_id)
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', '');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

                let pathname = valideUrl.pathname;
                let parameters = valideUrl.searchParams;
                if (parameters.size) {
                    console.log('parameters', parameters)
                }
                if (pathname.endsWith('/')) {
                    pathname += "index.html";
                } else {
                    let directory = pathname.split("/").slice(-1)[0];
                    if (!directory.includes('.')) {
                        pathname += "/index.html";
                    }
                }

                let data = {
                    method: 'read.object',
                    array: 'files',
                    filter: {
                        query: [
                            { key: "host", value: [hostname, '*'], operator: "$in" },
                            { key: "path", value: pathname, operator: "$eq" }
                        ]
                    },
                    organization_id
                }

                if (pathname.startsWith('/superadmin'))
                    data.organization_id = process.env.organization_id

                let file = await crud.send(data);

                if (!file || !file.object || !file.object[0]) {
                    data.filter.query[1].value = '/404.html'
                    if (data.organization_id !== organization_id)
                        data.organization_id = organization_id

                    let pageNotFound = await crud.send(data);
                    if (!pageNotFound || !pageNotFound.object || !pageNotFound.object[0])
                        pageNotFound = default404 || `${pathname} could not be found for ${organization_id}`
                    else
                        pageNotFound = pageNotFound.object[0].src
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    return res.end(pageNotFound);
                }

                file = file.object[0]
                if (!file['public'] || file['public'] === "false") {
                    data.filter.query[1].value = '/403.html'
                    if (data.organization_id !== organization_id)
                        data.organization_id = organization_id

                    let pageForbidden = await crud.send(data);
                    if (!pageForbidden || !pageForbidden.object || !pageForbidden.object[0])
                        pageForbidden = default403 || `${pathname} access not allowed for ${organization_id}`
                    else
                        pageForbidden = pageForbidden.object[0].src
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    return res.end(pageForbidden);
                }

                let src;
                if (file['src'])
                    src = file['src'];
                else {
                    let fileSrc = await crud.send({
                        method: 'read.object',
                        array: file['array'],
                        object: {
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

                    let pageNotFound = await crud.send(data);
                    if (!pageNotFound || !pageNotFound.object || !pageNotFound.object[0])
                        pageNotFound = `${pathname} could not be found for ${organization_id}`

                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    return res.end(pageNotFound);
                }

                let contentType = file['content-type'] || 'text/html';

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
                if (file.modified)
                    res.setHeader('Last-Modified', file.modified.on);

                res.writeHead(200, { 'Content-Type': contentType });
                return res.end(src);
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                return res.end('Invalid host format');
            }
        })
    }
}

module.exports = CoCreateFileSystem;
