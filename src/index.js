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

class CoCreateFileSystem {
	constructor(render, sitemap) {
		this.render = render;
		this.sitemap = sitemap;
	}

	async send(req, res, crud, organization, urlObject) {
		try {
			const hostname = urlObject.hostname;

			// --- determine preferred color scheme from browser headers ---
			let theme;
			const headerValue =
				(req && req.headers && (
					req.headers["sec-ch-prefers-color-scheme"] ||
					req.headers["prefers-color-scheme"] ||
					req.headers["x-prefers-color-scheme"] ||
					req.headers["x-color-scheme"]
				));
			if (typeof headerValue === "string") {
				// take first token, strip quotes, normalize
				const token = headerValue.split(",")[0].trim().replace(/^"|"$/g, "").toLowerCase();
				if (token === "dark" || token === "light") theme = token;
			}
			// optional: expose detected theme to clients / downstream code
			if (theme) res.setHeader("X-Preferred-Color-Scheme", theme);
			// --- end theme detection ---

			let data = {
				method: "object.read",
				host: hostname,
				array: "files",
				$filter: {
					query: {
						host: { $in: [hostname, "*"] }
					},
					limit: 1
				}
			};

			let organization_id;
			if (!organization || organization.error) {
				let hostNotFound = await getDefaultFile("/hostNotFound.html");
				return sendResponse(hostNotFound.object[0].src, 404, {
					"Content-Type": "text/html"
				});
			}

			organization_id = organization._id;
			data.organization_id = organization_id;

			res.setHeader("organization", organization_id);
			res.setHeader("storage", !!organization.storage);
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "");
			res.setHeader(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization"
			);

			let active = crud.wsManager.organizations.get(organization_id);
			if (active === false) {
				let balanceFalse = await getDefaultFile("/balanceFalse.html");
				return sendResponse(balanceFalse.object[0].src, 403, {
					"Content-Type": "text/html",
					"Account-Balance": "false",
					storage: organization.storage
				});
			}

			let parameters = urlObject.searchParams;
			if (parameters.size) {
				console.log("parameters", parameters);
			}

			let pathname = urlObject.pathname;

			if (pathname.endsWith("/")) {
				pathname += "index.html";
			} else if (!pathname.startsWith("/.well-known/acme-challenge")) {
				let directory = pathname.split("/").slice(-1)[0];
				if (!directory.includes(".")) pathname += "/index.html";
			}

			// Match both /en/ and /en-US/ style URLs
			const bcp47Regex = /^\/([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?)\//;
			const langMatch = pathname.match(bcp47Regex);
			let lang, langRegion;
			if (langMatch) {
				langRegion = langMatch[1];
				lang = langRegion.split("-")[0]; // Get just the base language (e.g., 'en', 'es', 'fr')
				let basePathname = pathname.replace("/" + langRegion, "");
				data.$filter.query.pathname = basePathname;
			} else {
				// No language in URL, try Accept-Language header
				let acceptLang = req.headers && req.headers["accept-language"];
				if (acceptLang) {
					// Parse the Accept-Language header, get the first language
					let preferred = acceptLang.split(",")[0].trim();
					if (preferred) {
						lang = preferred.split("-")[0];
						langRegion = preferred;
						// --- BEGIN OPTIONAL REDIRECT ---
						// Uncomment to enable automatic redirect to language-specific path
						// let newPath = `/${preferred}${pathname.startsWith('/') ? '' : '/'}${pathname.replace(/^\//, '')}`;
						// res.writeHead(302, { Location: newPath });
						// return res.end();
						// --- END OPTIONAL REDIRECT ---
					}
				}
				data.$filter.query.pathname = pathname;
			}

			let file;
			if (
				pathname.startsWith("/dist") ||
				pathname.startsWith("/admin") ||
				[
					"/403.html",
					"/404.html",
					"/offline.html",
					"/manifest.webmanifest",
					"/service-worker.js"
				].includes(pathname)
			) {
				file = await getDefaultFile(pathname);
			} else {
				file = await crud.send(data);
			}

			// --- Wildcard fallback ---
			if (!file || !file.object || !file.object[0]) {
				pathname = urlObject.pathname;
				let lastIndex = pathname.lastIndexOf("/");
				let wildcardPath = pathname.substring(0, lastIndex + 1);
				let wildcard = pathname.substring(lastIndex + 1);

				if (wildcard.includes(".")) {
					let fileLastIndex = wildcard.lastIndexOf(".");
					let fileExtension = wildcard.substring(fileLastIndex);
					wildcard = wildcardPath + "*" + fileExtension; // Create wildcard for file name
				} else {
					wildcard = wildcardPath + "*/index.html"; // Append '*' if it's just a path or folder
				}

				data.$filter.query.pathname = wildcard;
				file = await crud.send(data);
			}

			if (!file || !file.object || !file.object[0]) {
				let pageNotFound = await getDefaultFile("/404.html");
				return sendResponse(pageNotFound.object[0].src, 404, {
					"Content-Type": "text/html"
				});
			}

			file = file.object[0];
			if (!file["public"] || file["public"] === "false") {
				let pageForbidden = await getDefaultFile("/403.html");
				return sendResponse(pageForbidden.object[0].src, 403, {
					"Content-Type": "text/html"
				});
			}

			let src;
			if (file["src"]) {
				src = file["src"];
			} else {
				let fileSrc = await crud.send({
					method: "object.read",
					host: hostname,
					array: file["array"],
					object: {
						_id: file._id
					},
					organization_id
				});
				src = fileSrc[file["name"]];
			}

			if (!src) {
				let pageNotFound = await getDefaultFile("/404.html");
				return sendResponse(pageNotFound.object[0].src, 404, {
					"Content-Type": "text/html"
				});
			}

			let modifiedOn = file.modified || file.created;
			if (modifiedOn) {
				modifiedOn = modifiedOn.on;
				if (modifiedOn instanceof Date)
					modifiedOn = modifiedOn.toISOString();
				res.setHeader("Last-Modified", modifiedOn);
			}

			let contentType = file["content-type"] || "text/html";

			// Remove redundant handling for `src.src` in font file processing
			if (contentType.startsWith("font/") || /\.(woff2?|ttf|otf)$/i.test(pathname)) {
				try {
					if (typeof src === "string") {
						if (src.startsWith("data:font/")) {
							src = src.substring(src.indexOf(",") + 1);
						}
						if (/^([A-Za-z0-9+/]+={0,2})$/.test(src)) {
							// Decode base64-encoded font data
							src = Buffer.from(src, "base64");
						} else {
							throw new Error("Font data is not valid base64");
						}
					} else {
						throw new Error("Font data is not a valid base64 string");
					}
				} catch (err) {
					console.error("Error processing font file:", {
						message: err.message,
						contentType,
						srcType: typeof src
					});
					let pageNotFound = await getDefaultFile("/404.html");
					return sendResponse(pageNotFound.object[0].src, 404, {
						"Content-Type": "text/html"
					});
				}
			} else if (
				/^data:image\/[a-zA-Z0-9+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/.test(
					src
				)
			) {
				src = src.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
				src = Buffer.from(src, "base64");
			} else if (/^([A-Za-z0-9+/]+={0,2})$/.test(src)) {
				src = Buffer.from(src, "base64");
			} else if (contentType === "text/html") {
				try {
					let data = {};

					// pass detected theme (may be undefined) into server-side renderer
					src = await this.render.HTML(
						file,
						organization,
						urlObject,
						langRegion,
						lang,
						theme
					);
				} catch (err) {
					console.warn("server-side-render: " + err.message);
				}
			} else if (
				contentType === "text/xml" ||
				contentType === "application/xml"
			) {
				const protocol = "https://";
				src = src.replaceAll("{{$host}}", `${protocol}${hostname}`);
			} else if (contentType !== "text/javascript" || contentType === "text/css") {
			
				console.warn(`Unknown content type: ${contentType}`);
			}

			sendResponse(src, 200, { "Content-Type": contentType });
			this.sitemap.check(file, hostname);

			function sendResponse(src, statusCode, headers) {
				try {
					let cacheControl;
					if (statusCode >= 400) {
						cacheControl = "no-cache, no-store, must-revalidate";
					} else if (
						file &&
						file["cache-control"] !== undefined &&
						file["cache-control"] !== null
					) {
						const val = file["cache-control"];
						if (typeof val === "number" || /^\s*\d+\s*$/.test(val)) {
							// If it's numeric (number or numeric string) treat it as max-age.
							cacheControl = `public, max-age=${String(
								val
							).trim()};`;
						} else {
							// use the value verbatim (allow full Cache-Control strings like "no-cache" or "public, max-age=600")
							cacheControl = val;
						}
					} else {
						cacheControl = organization["cache-control"] || "public, max-age=3600";
					}

					// Always override/set Cache-Control header so the response aligns with the file metadata/defaults
					headers["Cache-Control"] = cacheControl;
					// Advertise that we accept the Sec-CH-Prefers-Color-Scheme client hint.
					// After the browser sees this in a response it may include
					// the Sec-CH-Prefers-Color-Scheme header on subsequent requests.
					headers["Accept-CH"] = "Sec-CH-Prefers-Color-Scheme";
					// optional: tell browser how long to remember this preference (seconds)
					headers["Accept-CH-Lifetime"] = "86400";
					// ensure caches/proxies vary responses by this hint
					headers["Vary"] = headers["Vary"]
						? headers["Vary"] + ", Sec-CH-Prefers-Color-Scheme"
						: "Sec-CH-Prefers-Color-Scheme";

					if (src instanceof Uint8Array || Buffer.isBuffer(src)) {
						// Ensure binary data is sent as-is
					} else if (typeof src === "object") {
						src = JSON.stringify(src);
					}

					if (organization_id)
						crud.wsManager.emit("setBandwidth", {
							type: "out",
							data: src,
							organization_id
						});
					res.writeHead(statusCode, headers);
					return res.end(src);
				} catch (error) {
					console.log(error);
				}
			}

			async function getDefaultFile(fileName) {
				data.$filter.query.pathname = fileName;
				// data.$filter.query.$or[0] = { pathname: fileName }
				let defaultFile;
				if (fileName !== "/hostNotFound.html")
					defaultFile = await crud.send(data);

				if (
					defaultFile &&
					defaultFile.object &&
					defaultFile.object[0] &&
					defaultFile.object[0].src
				) {
					return defaultFile;
				} else {
					data.$filter.query.host.$in = ["*"];
					data.organization_id = process.env.organization_id;

					if (fileName.startsWith("/admin"))
						data.$filter.query.pathname =
							"/superadmin" + fileName.replace("/admin", "");

					defaultFile = await crud.send(data);

					if (fileName !== "/hostNotFound.html") {
						crud.wsManager.emit("setBandwidth", {
							type: "out",
							data,
							organization_id
						});

						crud.wsManager.emit("setBandwidth", {
							type: "in",
							data: defaultFile,
							organization_id
						});
					}

					if (
						defaultFile &&
						defaultFile.object &&
						defaultFile.object[0] &&
						defaultFile.object[0].src
					) {
						if (fileName.startsWith("/admin")) {
							data.object[0].directory = "admin";
							data.object[0].path =
								"/admin" +
								data.object[0].path.replace("/superadmin", "");
							data.object[0].pathname = fileName;
						}

						crud.send({
							method: "object.create",
							host: hostname,
							array: "files",
							object: defaultFile.object[0],
							organization_id
						});

						return defaultFile;
					} else {
						switch (fileName) {
							case "/403.html":
								defaultFile.object = [
									{
										src: `${pathname} access not allowed for ${organization_id}`
									}
								];
								break;
							case "/404.html":
								defaultFile.object = [
									{
										src: `${pathname} could not be found for ${organization_id}`
									}
								];
								break;
							case "/balanceFalse.html":
								defaultFile.object = [
									{
										src: "This organizations account balance has fallen bellow 0: "
									}
								];
								break;
							case "/hostNotFound.html":
								defaultFile.object = [
									{
										src:
											"An organization could not be found using the host: " +
											hostname +
											" in platformDB: " +
											process.env.organization_id
									}
								];
								break;
						}
						return defaultFile;
					}
				}
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "text/plain" });
			res.end("Invalid host format");
		}
	}
}

module.exports = CoCreateFileSystem;
