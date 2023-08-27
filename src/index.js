/********************************************************************************
 * Copyright (C) 2023 CoCreate and Contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 ********************************************************************************/

// Commercial Licensing Information:
// For commercial use of this software without the copyleft provisions of the AGPLv3,
// you must obtain a commercial license from CoCreate LLC.
// For details, visit <https://cocreate.app/licenses/> or contact us at sales@cocreate.app.

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
                        res.writeHead(404, { 'Content-Type': 'text/html' });
                        if (org.storage === false && org.error)
                            res.setHeader('storage', 'false')
                        else
                            res.setHeader('storage', 'true')

                        return res.end(hostNotFound);
                    } else {
                        organization = { _id: org.object[0]._id, storage: !!org.object[0].storage }
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
                if (file.storage === false && file.error)
                    res.setHeader('storage', 'false')
                else
                    res.setHeader('storage', 'true')

                const fileContent = req.headers['File-Content']
                if (fileContent && !pathname.startsWith('/superadmin')) {
                    crud.wsManager.emit("setBandwidth", {
                        type: 'in',
                        data: fileContent,
                        organization_id
                    });

                    crud.wsManager.emit("setBandwidth", {
                        type: 'out',
                        data: fileContent,
                        organization_id
                    });

                    res.writeHead(200, { 'Content-Type': req.headers['Content-Type'] });
                    return res.end(fileContent);
                }

                if (!file || !file.object || !file.object[0]) {
                    data.filter.query[1].value = '/404.html'
                    if (data.organization_id !== organization_id)
                        data.organization_id = organization_id

                    let pageNotFound = await crud.send(data);
                    if (!pageNotFound || !pageNotFound.object || !pageNotFound.object[0])
                        pageNotFound = default404 || `${pathname} could not be found for ${organization_id}`
                    else
                        pageNotFound = pageNotFound.object[0].src

                    crud.wsManager.emit("setBandwidth", {
                        type: 'out',
                        data: pageNotFound,
                        organization_id
                    });

                    res.writeHead(404, { 'Content-Type': 'text/html' });
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

                    crud.wsManager.emit("setBandwidth", {
                        type: 'out',
                        data: pageForbidden,
                        organization_id
                    });

                    res.writeHead(403, { 'Content-Type': 'text/html' });
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
                    else
                        pageNotFound = pageNotFound.object[0].src

                    crud.wsManager.emit("setBandwidth", {
                        type: 'out',
                        data: pageNotFound,
                        organization_id
                    });

                    res.writeHead(404, { 'Content-Type': 'text/html' });
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

                crud.wsManager.emit("setBandwidth", {
                    type: 'out',
                    data: src,
                    organization_id
                });

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
